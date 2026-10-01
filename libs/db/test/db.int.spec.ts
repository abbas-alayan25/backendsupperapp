import { AppError, newId, runWithContext } from '@super-app/common';
import { checkTenantIsolation, isIsolated, twoTenants } from '@super-app/testing';
import { Redis } from 'ioredis';
import { type Transaction, sql } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IdempotencyStore,
  InvalidTenantError,
  OutboxWriter,
  findUnexpectedBypassRlsRoles,
  inTenantTransaction,
  insertWithKey,
  processOnce,
  purgeStdTables,
  runtimeRolesWithBypass,
  withTenant,
} from '../src/index.js';
import {
  type DemoDatabase,
  type DemoTables,
  SCHEMA,
  outboxRow,
  startDemoDatabase,
} from './demo-schema.js';

let demo: DemoDatabase;
const { tenantA, tenantB } = twoTenants();

beforeAll(async () => {
  demo = await startDemoDatabase();
});

afterAll(async () => {
  await demo.stop();
});

async function appPool(): Promise<pg.Pool> {
  const { default: pgModule } = await import('pg');
  return new pgModule.Pool({
    connectionString: demo.postgres.uri({ user: 'demo_service', password: 'demo-password' }),
    max: 3,
  });
}

describe('row-level security', () => {
  const tables: {
    table: string;
    insert: (client: pg.PoolClient, tenantId: string) => Promise<string>;
  }[] = [
    {
      table: 'demo.widgets',
      insert: async (client, tenantId) => {
        const id = newId();
        await client.query("INSERT INTO demo.widgets (id, tenant_id, name) VALUES ($1, $2, 'w')", [
          id,
          tenantId,
        ]);
        return id;
      },
    },
    {
      table: 'demo.events',
      insert: async (client, tenantId) => {
        const id = newId();
        await client.query(
          "INSERT INTO demo.events (id, tenant_id, widget_id, note) VALUES ($1, $2, $3, 'n')",
          [id, tenantId, newId()],
        );
        return id;
      },
    },
    {
      table: 'demo.outbox_events',
      insert: async (client, tenantId) => {
        const row = outboxRow(tenantId);
        await client.query(
          `INSERT INTO demo.outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, event_version, producer, topic, message_key, payload)
           VALUES ($1, $2, 'widget', $3, 'widget.created', 1, 'demo', 'platform.config', $4, '{}')`,
          [row.id, tenantId, row.aggregate_id, row.message_key],
        );
        return row.id;
      },
    },
    {
      table: 'demo.idempotency_keys',
      insert: async (client, tenantId) => {
        const id = newId();
        await client.query(
          `INSERT INTO demo.idempotency_keys (id, tenant_id, key, actor_type, actor_id, request_hash, expires_at)
           VALUES ($1, $2, $3, 'USER', 'u1', 'h', now() + interval '1 day')`,
          [id, tenantId, newId()],
        );
        return id;
      },
    },
    {
      table: 'demo.inbox_events',
      insert: async (client, tenantId) => {
        const id = newId();
        await client.query(
          "INSERT INTO demo.inbox_events (id, tenant_id, event_id, topic) VALUES ($1, $2, $3, 't')",
          [id, tenantId, newId()],
        );
        return id;
      },
    },
    {
      table: 'demo.event_keys',
      insert: async (client, tenantId) => {
        const id = newId();
        await client.query(
          'INSERT INTO demo.event_keys (tenant_id, external_ref, event_id) VALUES ($1, $2, $3)',
          [tenantId, newId(), id],
        );
        return id;
      },
    },
  ];

  it.each(tables)('isolates tenants in $table', async ({ table, insert }) => {
    const pool = await appPool();
    try {
      const report = await checkTenantIsolation({
        pool,
        table,
        tenantA,
        tenantB,
        insertRow: insert,
        idColumn: table === 'demo.event_keys' ? 'event_id' : 'id',
      });
      expect(report).toMatchObject({
        ownerSeesRow: true,
        otherTenantSeesRow: false,
        otherTenantUpdated: 0,
        crossTenantInsertBlocked: true,
        noTenantSeesRows: true,
      });
      expect(isIsolated(report)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('fails closed without a tenant', async () => {
    const rows = await demo.app.withSchema(SCHEMA).selectFrom('widgets').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('rejects non-UUID tenants before touching the database', async () => {
    await expect(
      withTenant(demo.app, "' OR 1=1 --", () => Promise.resolve(1)),
    ).rejects.toBeInstanceOf(InvalidTenantError);
  });

  it('takes the tenant from the request context', async () => {
    const seen = await runWithContext({ tenantId: tenantA, requestId: 'r', locale: 'en' }, () =>
      inTenantTransaction(demo.app, async (trx) => {
        const result = await sql<{
          tenant: string;
        }>`SELECT current_setting('app.tenant_id') AS tenant`.execute(trx);
        return result.rows[0]?.tenant;
      }),
    );
    expect(seen).toBe(tenantA);
  });

  it('keeps the tenant setting local to the transaction', async () => {
    await withTenant(demo.app, tenantA, () => Promise.resolve());
    const result = await sql<{
      tenant: string | null;
    }>`SELECT current_setting('app.tenant_id', true) AS tenant`.execute(demo.app);
    expect(result.rows[0]?.tenant ?? '').toBe('');
  });
});

describe('roles', () => {
  it('gives no runtime role BYPASSRLS', async () => {
    expect(
      await runtimeRolesWithBypass(demo.admin, [
        'demo_service',
        'demo_janitor',
        'demo_app',
        'demo_maint',
      ]),
    ).toEqual([]);
    expect(await findUnexpectedBypassRlsRoles(demo.admin)).toEqual([]);
  });

  it('detects a runtime role that has BYPASSRLS', async () => {
    await sql`CREATE ROLE sneaky_app LOGIN BYPASSRLS`.execute(demo.admin);
    try {
      expect(await findUnexpectedBypassRlsRoles(demo.admin)).toEqual(['sneaky_app']);
      expect(await runtimeRolesWithBypass(demo.admin, ['sneaky_app'])).toEqual(['sneaky_app']);
    } finally {
      await sql`DROP ROLE sneaky_app`.execute(demo.admin);
    }
  });

  it('makes the schema owner role own every table and partition', async () => {
    const owners = await sql<{ tablename: string; tableowner: string }>`
      SELECT tablename, tableowner FROM pg_tables WHERE schemaname = ${SCHEMA} ORDER BY tablename
    `.execute(demo.admin);
    expect(owners.rows.filter((row) => row.tableowner !== 'demo_owner')).toEqual([]);
    expect(owners.rows.some((row) => row.tablename.startsWith('events_p'))).toBe(true);
  });

  it('denies UPDATE and DELETE on append-only tables', async () => {
    await expect(
      withTenant(demo.app, tenantA, (trx) =>
        trx.withSchema(SCHEMA).updateTable('events').set({ note: 'x' }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(demo.app, tenantA, (trx) => trx.withSchema(SCHEMA).deleteFrom('events').execute()),
    ).rejects.toThrow(/permission denied/);
  });

  it('bumps updated_at on mutable tables', async () => {
    const id = newId();
    await withTenant(demo.app, tenantA, (trx) =>
      trx
        .withSchema(SCHEMA)
        .insertInto('widgets')
        .values({ id, tenant_id: tenantA, name: 'a' })
        .execute(),
    );
    const before = await withTenant(demo.app, tenantA, (trx) =>
      trx
        .withSchema(SCHEMA)
        .selectFrom('widgets')
        .select('updated_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await withTenant(demo.app, tenantA, (trx) =>
      trx
        .withSchema(SCHEMA)
        .updateTable('widgets')
        .set({ name: 'b' })
        .where('id', '=', id)
        .execute(),
    );
    const after = await withTenant(demo.app, tenantA, (trx) =>
      trx
        .withSchema(SCHEMA)
        .selectFrom('widgets')
        .select('updated_at')
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });
});

describe('monthly partitions', () => {
  it('routes rows into monthly partitions created by pg_partman', async () => {
    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 15);
    await withTenant(demo.app, tenantA, (trx) =>
      trx
        .withSchema(SCHEMA)
        .insertInto('events')
        .values([
          { id: newId(), tenant_id: tenantA, widget_id: newId(), note: 'now' },
          {
            id: newId(),
            tenant_id: tenantA,
            widget_id: newId(),
            note: 'later',
            created_at: nextMonth,
          },
        ])
        .execute(),
    );
    const placement = await sql<{ partition: string; note: string }>`
      SELECT tableoid::regclass::text AS partition, note FROM demo.events WHERE note IN ('now', 'later')
    `.execute(demo.admin);
    const partitions = new Set(placement.rows.map((row) => row.partition));
    expect(partitions.size).toBe(2);
    for (const partition of partitions) {
      expect(partition).toMatch(/^demo\.events_p\d{8}$/);
    }
  });
});

describe('outbox writer', () => {
  const writer = new OutboxWriter(SCHEMA, 'demo-service');

  it('writes the event in the same transaction as the state change', async () => {
    const widgetId = newId();
    const eventId = await withTenant(demo.app, tenantA, async (trx) => {
      await trx
        .withSchema(SCHEMA)
        .insertInto('widgets')
        .values({ id: widgetId, tenant_id: tenantA, name: 'w' })
        .execute();
      return writer.write(trx, {
        tenantId: tenantA,
        topic: 'platform.config',
        eventType: 'flag.changed',
        eventVersion: 1,
        aggregateType: 'feature_flag',
        aggregateId: widgetId,
        ownerId: tenantA,
        payload: { flagKey: 'p2p', enabled: true },
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      });
    });
    const row = await withTenant(demo.app, tenantA, (trx) =>
      trx
        .withSchema(SCHEMA)
        .selectFrom('outbox_events')
        .selectAll()
        .where('id', '=', eventId)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toMatchObject({
      topic: 'platform.config',
      message_key: `${tenantA}:${tenantA}`,
      event_type: 'flag.changed',
      event_version: 1,
      producer: 'demo-service',
      payload: { flagKey: 'p2p', enabled: true },
      headers: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
      published_at: null,
    });
  });

  it('rolls the event back with the state change', async () => {
    const widgetId = newId();
    await expect(
      withTenant(demo.app, tenantA, async (trx) => {
        await trx
          .withSchema(SCHEMA)
          .insertInto('widgets')
          .values({ id: widgetId, tenant_id: tenantA, name: 'w' })
          .execute();
        await writer.write(trx, {
          tenantId: tenantA,
          topic: 'platform.config',
          eventType: 'flag.changed',
          eventVersion: 1,
          aggregateType: 'feature_flag',
          aggregateId: widgetId,
          ownerId: tenantA,
          payload: {},
        });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    const leftovers = await withTenant(demo.app, tenantA, (trx) =>
      trx
        .withSchema(SCHEMA)
        .selectFrom('outbox_events')
        .select('id')
        .where('aggregate_id', '=', widgetId)
        .execute(),
    );
    expect(leftovers).toHaveLength(0);
  });

  it.each([
    [{ topic: 'payments.payment' }, /unknown topic/],
    [{ eventType: 'FlagChanged' }, /event type/],
    [{ eventVersion: 0 }, /version/],
    [{ aggregateId: 'not-a-uuid' }, /UUID/],
  ])('rejects invalid events %#', async (override, message) => {
    await expect(
      withTenant(demo.app, tenantA, (trx) =>
        writer.write(trx, {
          tenantId: tenantA,
          topic: 'platform.config',
          eventType: 'flag.changed',
          eventVersion: 1,
          aggregateType: 'feature_flag',
          aggregateId: newId(),
          ownerId: tenantA,
          payload: {},
          ...(override as object),
        }),
      ),
    ).rejects.toThrow(message);
  });

  it('lets only the relay role read across tenants', async () => {
    await withTenant(demo.app, tenantB, (trx) =>
      writer.write(trx, {
        tenantId: tenantB,
        topic: 'platform.config',
        eventType: 'flag.changed',
        eventVersion: 1,
        aggregateType: 'feature_flag',
        aggregateId: newId(),
        ownerId: tenantB,
        payload: {},
      }),
    );
    const relayTenants = await demo.relay
      .withSchema(SCHEMA)
      .selectFrom('outbox_events')
      .select('tenant_id')
      .distinct()
      .execute();
    expect(new Set(relayTenants.map((row) => row.tenant_id))).toEqual(new Set([tenantA, tenantB]));
    const appRows = await demo.app
      .withSchema(SCHEMA)
      .selectFrom('outbox_events')
      .select('id')
      .execute();
    expect(appRows).toHaveLength(0);
  });
});

describe('Prisma outbox writer', () => {
  it('writes the same row shape through a Prisma-style transaction client', async () => {
    const { default: pgModule } = await import('pg');
    const client = new pgModule.Client({
      connectionString: demo.postgres.uri({ user: 'demo_service', password: 'demo-password' }),
    });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const tx = {
        $executeRawUnsafe: async (query: string, ...values: unknown[]) =>
          (await client.query(query, values)).rowCount ?? 0,
      };
      const aggregateId = newId();
      const id = await new OutboxWriter(SCHEMA, 'prisma-service').writePrisma(tx, {
        tenantId: tenantA,
        topic: 'tenancy.tenants',
        eventType: 'tenant.created',
        eventVersion: 1,
        aggregateType: 'tenant',
        aggregateId,
        ownerId: tenantA,
        payload: { code: 'acme-lb' },
      });
      await client.query('COMMIT');
      const row = await withTenant(demo.app, tenantA, (trx) =>
        trx
          .withSchema(SCHEMA)
          .selectFrom('outbox_events')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow(),
      );
      expect(row).toMatchObject({
        topic: 'tenancy.tenants',
        event_type: 'tenant.created',
        producer: 'prisma-service',
        message_key: `${tenantA}:${tenantA}`,
        payload: { code: 'acme-lb' },
        aggregate_id: aggregateId,
      });
    } finally {
      await client.end();
    }
  });
});

describe('insertWithKey', () => {
  const createEvent = (trx: Transaction<DemoTables>, tenantId: string) => async (id: string) => {
    await trx
      .withSchema(SCHEMA)
      .insertInto('events')
      .values({ id, tenant_id: tenantId, widget_id: newId(), note: 'keyed' })
      .execute();
    return id;
  };
  const loadEvent = (trx: Transaction<DemoTables>) => async (id: string) => {
    const row = await trx
      .withSchema(SCHEMA)
      .selectFrom('events')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return row.id;
  };

  it('creates once and returns the existing row on a repeated key', async () => {
    const key = { external_ref: `ref-${newId()}` };
    const target = {
      schema: SCHEMA,
      table: 'event_keys',
      refColumn: 'event_id',
      key,
      tenantId: tenantA,
    };
    const first = await withTenant(demo.app, tenantA, (trx) =>
      insertWithKey(trx, target, createEvent(trx, tenantA), loadEvent(trx)),
    );
    const second = await withTenant(demo.app, tenantA, (trx) =>
      insertWithKey(trx, target, createEvent(trx, tenantA), loadEvent(trx)),
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, id: first.id, value: first.id });
  });

  it('creates exactly one row under concurrency', async () => {
    const key = { external_ref: `ref-${newId()}` };
    const target = {
      schema: SCHEMA,
      table: 'event_keys',
      refColumn: 'event_id',
      key,
      tenantId: tenantA,
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        withTenant(demo.app, tenantA, (trx) =>
          insertWithKey(trx, target, createEvent(trx, tenantA), loadEvent(trx)),
        ),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
  });

  it('scopes keys per tenant', async () => {
    const key = { external_ref: `ref-${newId()}` };
    const run = (tenantId: string) =>
      withTenant(demo.app, tenantId, (trx) =>
        insertWithKey(
          trx,
          { schema: SCHEMA, table: 'event_keys', refColumn: 'event_id', key, tenantId },
          createEvent(trx, tenantId),
          loadEvent(trx),
        ),
      );
    const [a, b] = [await run(tenantA), await run(tenantB)];
    expect(a.created && b.created).toBe(true);
    expect(a.id).not.toBe(b.id);
  });
});

describe('inbox', () => {
  it('processes an event once per tenant', async () => {
    const eventId = newId();
    let handled = 0;
    const handle = (tenantId: string) =>
      withTenant(demo.app, tenantId, (trx) =>
        processOnce(trx, { schema: SCHEMA, eventId, topic: 'platform.config', tenantId }, () => {
          handled += 1;
          return Promise.resolve('ok');
        }),
      );
    expect(await handle(tenantA)).toEqual({ processed: true, value: 'ok' });
    expect(await handle(tenantA)).toEqual({ processed: false });
    expect(await handle(tenantB)).toEqual({ processed: true, value: 'ok' });
    expect(handled).toBe(2);
  });

  it('forgets the event when the handler fails', async () => {
    const eventId = newId();
    const run = (fail: boolean) =>
      withTenant(demo.app, tenantA, (trx) =>
        processOnce(trx, { schema: SCHEMA, eventId, topic: 't', tenantId: tenantA }, () =>
          fail ? Promise.reject(new Error('handler failed')) : Promise.resolve('ok'),
        ),
      );
    await expect(run(true)).rejects.toThrow('handler failed');
    expect(await run(false)).toEqual({ processed: true, value: 'ok' });
  });
});

describe('purge', () => {
  it('removes expired rows for one tenant only', async () => {
    const tenant = newId();
    const other = newId();
    const longAgo = new Date(Date.now() - 60 * 86_400_000);
    for (const t of [tenant, other]) {
      await withTenant(demo.app, t, async (trx) => {
        await trx
          .withSchema(SCHEMA)
          .insertInto('idempotency_keys')
          .values({
            id: newId(),
            tenant_id: t,
            key: newId(),
            actor_type: 'USER',
            actor_id: 'u',
            request_hash: 'h',
            response_code: 200,
            response_body: '{}',
            locked_until: null,
            expires_at: longAgo,
          })
          .execute();
        await trx
          .withSchema(SCHEMA)
          .insertInto('inbox_events')
          .values({
            id: newId(),
            tenant_id: t,
            event_id: newId(),
            topic: 't',
            processed_at: longAgo,
          })
          .execute();
      });
    }
    await sql`UPDATE demo.outbox_events SET published_at = ${longAgo} WHERE tenant_id = ${tenant}`.execute(
      demo.admin,
    );
    await withTenant(demo.app, tenant, (trx) =>
      new OutboxWriter(SCHEMA, 'demo').write(trx, {
        tenantId: tenant,
        topic: 'platform.config',
        eventType: 'flag.changed',
        eventVersion: 1,
        aggregateType: 'feature_flag',
        aggregateId: newId(),
        ownerId: tenant,
        payload: {},
      }),
    );
    await sql`UPDATE demo.outbox_events SET published_at = ${longAgo} WHERE tenant_id = ${tenant}`.execute(
      demo.admin,
    );

    const result = await withTenant(demo.maint, tenant, (trx) => purgeStdTables(trx, SCHEMA));
    expect(result).toEqual({ idempotencyKeys: 1, outboxEvents: 1, inboxEvents: 1 });
    const remaining = await withTenant(demo.app, other, (trx) =>
      trx.withSchema(SCHEMA).selectFrom('idempotency_keys').select('id').execute(),
    );
    expect(remaining).toHaveLength(1);
  });

  it('cannot delete through the runtime role', async () => {
    await expect(
      withTenant(demo.app, tenantA, (trx) => purgeStdTables(trx, SCHEMA)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('idempotency store', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(demo.redis.url);
  });

  afterAll(async () => {
    await redis.quit();
  });

  const store = () => new IdempotencyStore(demo.app, redis, SCHEMA);
  const request = (overrides: Partial<Parameters<IdempotencyStore['begin']>[0]> = {}) => ({
    tenantId: tenantA,
    key: newId(),
    actor: { type: 'USER' as const, id: 'user-1' },
    requestHash: 'hash-1',
    ...overrides,
  });

  async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(code);
      return error as AppError;
    }
    throw new Error(`expected ${code}`);
  }

  it('replays the stored response for the same request', async () => {
    const req = request();
    const begin = await store().begin(req);
    expect(begin.kind).toBe('proceed');
    if (begin.kind !== 'proceed') return;
    await store().complete(req, begin.lockToken, { status: 201, body: { paymentId: 'p1' } });
    expect(await store().begin(req)).toEqual({
      kind: 'replay',
      status: 201,
      body: { paymentId: 'p1' },
    });
  });

  it('returns DUPLICATE_REQUEST for the same key with a different body', async () => {
    const req = request();
    const begin = await store().begin(req);
    if (begin.kind !== 'proceed') throw new Error('expected proceed');
    await store().complete(req, begin.lockToken, { status: 201, body: {} });
    await expectAppError(store().begin({ ...req, requestHash: 'hash-2' }), 'DUPLICATE_REQUEST');
  });

  it('returns CONFLICT when another actor reuses the key', async () => {
    const req = request();
    const begin = await store().begin(req);
    if (begin.kind !== 'proceed') throw new Error('expected proceed');
    await store().complete(req, begin.lockToken, { status: 201, body: {} });
    await expectAppError(
      store().begin({ ...req, actor: { type: 'USER', id: 'user-2' } }),
      'CONFLICT',
    );
  });

  it('returns CONFLICT with Retry-After while the first request is in flight', async () => {
    const req = request();
    expect((await store().begin(req)).kind).toBe('proceed');
    const error = await expectAppError(store().begin(req), 'CONFLICT');
    expect(error.retryAfterSeconds).toBe(1);
    expect(await redis.pttl(`t:${tenantA}:idem:${req.key}`)).toBeGreaterThan(50_000);
  });

  it('stores 4xx business errors and replays them', async () => {
    const req = request();
    const begin = await store().begin(req);
    if (begin.kind !== 'proceed') throw new Error('expected proceed');
    const envelope = { error: { code: 'INSUFFICIENT_FUNDS' } };
    await store().complete(req, begin.lockToken, { status: 422, body: envelope });
    expect(await store().begin(req)).toEqual({ kind: 'replay', status: 422, body: envelope });
  });

  it('does not store 5xx responses and releases the lock', async () => {
    const req = request();
    const begin = await store().begin(req);
    if (begin.kind !== 'proceed') throw new Error('expected proceed');
    await store().complete(req, begin.lockToken, { status: 503, body: {} });
    expect((await store().begin(req)).kind).toBe('proceed');
  });

  it('releases the lock when abandoned', async () => {
    const req = request();
    const begin = await store().begin(req);
    if (begin.kind !== 'proceed') throw new Error('expected proceed');
    await store().abandon(req, begin.lockToken);
    expect((await store().begin(req)).kind).toBe('proceed');
  });

  it('treats keys as new after 24 hours', async () => {
    const req = request();
    const start = new Date();
    const early = new IdempotencyStore(demo.app, redis, SCHEMA, () => start);
    const begin = await early.begin(req);
    if (begin.kind !== 'proceed') throw new Error('expected proceed');
    await early.complete(req, begin.lockToken, { status: 201, body: { n: 1 } });
    const later = new IdempotencyStore(
      demo.app,
      redis,
      SCHEMA,
      () => new Date(start.getTime() + 25 * 3_600_000),
    );
    const again = await later.begin({ ...req, requestHash: 'another' });
    if (again.kind !== 'proceed') throw new Error('expected proceed');
    await later.complete({ ...req, requestHash: 'another' }, again.lockToken, {
      status: 201,
      body: { n: 2 },
    });
    expect(await later.begin({ ...req, requestHash: 'another' })).toEqual({
      kind: 'replay',
      status: 201,
      body: { n: 2 },
    });
  });

  it('scopes keys per tenant', async () => {
    const req = request();
    const begin = await store().begin(req);
    if (begin.kind !== 'proceed') throw new Error('expected proceed');
    await store().complete(req, begin.lockToken, { status: 201, body: {} });
    expect((await store().begin({ ...req, tenantId: tenantB })).kind).toBe('proceed');
  });
});
