import { newId } from '@super-app/common';
import {
  type PostgresFixture,
  type RedisFixture,
  startPostgres,
  startRedis,
} from '@super-app/testing';
import type { Generated, Kysely } from 'kysely';
import {
  createDatabase,
  createTableSql,
  keyTableSql,
  loginRoleSql,
  schemaSetupSql,
  stdTablesSql,
  type StdTables,
} from '../src/index.js';

export const SCHEMA = 'demo';
export const PASSWORD = 'demo-password';

export interface DemoTables extends StdTables {
  widgets: {
    id: string;
    tenant_id: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    version: Generated<number>;
    name: string;
  };
  events: {
    id: string;
    tenant_id: string;
    created_at: Generated<Date>;
    widget_id: string;
    note: string;
  };
  event_keys: {
    tenant_id: string;
    external_ref: string;
    event_id: string;
    created_at: Generated<Date>;
  };
}

export interface DemoDatabase {
  postgres: PostgresFixture;
  redis: RedisFixture;
  app: Kysely<DemoTables>;
  relay: Kysely<DemoTables>;
  maint: Kysely<DemoTables>;
  admin: Kysely<DemoTables>;
  stop(): Promise<void>;
}

export async function startDemoDatabase(): Promise<DemoDatabase> {
  const [postgres, redis] = await Promise.all([startPostgres(), startRedis()]);
  await postgres.admin.query(schemaSetupSql(SCHEMA));
  await postgres.admin.query(stdTablesSql(SCHEMA));
  await postgres.admin.query(
    createTableSql({
      schema: SCHEMA,
      table: 'widgets',
      kind: 'mutable',
      columns: ['name text NOT NULL'],
      indexes: ['CREATE INDEX ON demo.widgets (tenant_id, name)'],
    }),
  );
  await postgres.admin.query(
    createTableSql({
      schema: SCHEMA,
      table: 'events',
      kind: 'append-only',
      partitioned: true,
      columns: ['widget_id uuid NOT NULL', 'note text NOT NULL'],
    }),
  );
  await postgres.admin.query(
    keyTableSql(SCHEMA, 'event_keys', [{ name: 'external_ref', type: 'text' }], 'event_id'),
  );
  await postgres.admin.query(
    [
      loginRoleSql({ name: 'demo_service', password: PASSWORD, memberOf: 'demo_app' }),
      loginRoleSql({ name: 'demo_janitor', password: PASSWORD, memberOf: 'demo_maint' }),
      loginRoleSql({
        name: 'demo_outbox_relay',
        password: PASSWORD,
        memberOf: 'demo_relay',
        bypassRls: true,
      }),
    ].join('\n'),
  );
  const connect = (user?: string) =>
    createDatabase<DemoTables>({
      connectionString: postgres.uri(user ? { user, password: PASSWORD } : {}),
      maxConnections: 5,
    });
  const app = connect('demo_service');
  const relay = connect('demo_outbox_relay');
  const maint = connect('demo_janitor');
  const admin = connect();
  return {
    postgres,
    redis,
    app,
    relay,
    maint,
    admin,
    async stop() {
      await Promise.all([app.destroy(), relay.destroy(), maint.destroy(), admin.destroy()]);
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}

export function outboxRow(tenantId: string) {
  return {
    id: newId(),
    tenant_id: tenantId,
    aggregate_type: 'widget',
    aggregate_id: newId(),
    event_type: 'widget.created',
    event_version: 1,
    producer: 'demo',
    topic: 'platform.config',
    message_key: `${tenantId}:owner`,
    payload: '{}',
    headers: '{}',
    published_at: null,
  };
}
