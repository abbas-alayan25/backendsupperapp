import { newId } from '@super-app/common';
import {
  OutboxWriter,
  createDatabase,
  createTableSql,
  loginRoleSql,
  schemaSetupSql,
  stdTablesSql,
  type StdTables,
  withTenant,
} from '@super-app/db';
import {
  type KafkaFixture,
  type PostgresFixture,
  startKafka,
  startPostgres,
  twoTenants,
} from '@super-app/testing';
import type { Generated, Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AvroEventSerde,
  type Consumer,
  EventCatalog,
  EventConsumer,
  type KafkaClient,
  type KafkaMessage,
  OutboxRelay,
  type Producer,
  SchemaValidationError,
  createKafka,
  createProducer,
  createSchemaRegistry,
  ensureTopics,
  registerCatalog,
  subjectName,
} from '../src/index.js';

const SCHEMA = 'kdemo';
const PASSWORD = 'kdemo-password';
const TOPIC = 'platform.config';

interface Tables extends StdTables {
  flag_views: {
    id: string;
    tenant_id: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    version: Generated<number>;
    flag_key: string;
    event_id: string;
  };
}

const catalog = new EventCatalog([
  {
    topic: TOPIC,
    eventType: 'flag.changed',
    dataFields: [
      { name: 'flagKey', type: 'string' },
      { name: 'enabled', type: 'boolean' },
    ],
  },
]);

let postgres: PostgresFixture;
let kafkaFixture: KafkaFixture;
let app: Kysely<Tables>;
let relayDb: Kysely<Tables>;
let admin: Kysely<Tables>;
let kafka: KafkaClient;
let producer: Producer;
let serde: AvroEventSerde;
let registryUrl: string;
const { tenantA, tenantB } = twoTenants();
const writer = new OutboxWriter(SCHEMA, 'kafka-test');
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  [postgres, kafkaFixture] = await Promise.all([
    startPostgres(),
    startKafka({ schemaRegistry: true }),
  ]);
  await postgres.admin.query(schemaSetupSql(SCHEMA));
  await postgres.admin.query(stdTablesSql(SCHEMA));
  await postgres.admin.query(
    createTableSql({
      schema: SCHEMA,
      table: 'flag_views',
      kind: 'mutable',
      columns: ['flag_key text NOT NULL', 'event_id uuid NOT NULL'],
    }),
  );
  await postgres.admin.query(
    [
      loginRoleSql({ name: 'kdemo_service', password: PASSWORD, memberOf: 'kdemo_app' }),
      loginRoleSql({
        name: 'kdemo_outbox_relay',
        password: PASSWORD,
        memberOf: 'kdemo_relay',
        bypassRls: true,
      }),
    ].join('\n'),
  );
  app = createDatabase<Tables>({
    connectionString: postgres.uri({ user: 'kdemo_service', password: PASSWORD }),
  });
  relayDb = createDatabase<Tables>({
    connectionString: postgres.uri({ user: 'kdemo_outbox_relay', password: PASSWORD }),
  });
  admin = createDatabase<Tables>({ connectionString: postgres.uri() });

  kafka = createKafka({ brokers: [kafkaFixture.bootstrapServers], clientId: 'kafka-test' });
  const kafkaAdmin = kafka.admin();
  await kafkaAdmin.connect();
  await ensureTopics(kafkaAdmin, [TOPIC], { replicationFactor: 1, partitionsOverride: 3 });
  await kafkaAdmin.disconnect();
  producer = createProducer(kafka);
  await producer.connect();

  registryUrl = kafkaFixture.schemaRegistryUrl ?? '';
  const registry = createSchemaRegistry(registryUrl);
  await registerCatalog(registry, catalog);
  serde = new AvroEventSerde(registry, catalog);
});

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) {
    await cleanup();
  }
  await producer.disconnect();
  await Promise.all([app.destroy(), relayDb.destroy(), admin.destroy()]);
  await Promise.all([postgres.stop(), kafkaFixture.stop()]);
});

async function writeFlagEvent(
  tenantId: string,
  flagKey: string,
  enabled: unknown = true,
): Promise<string> {
  return withTenant(app, tenantId, (trx) =>
    writer.write(trx, {
      tenantId,
      topic: TOPIC,
      eventType: 'flag.changed',
      eventVersion: 1,
      aggregateType: 'feature_flag',
      aggregateId: newId(),
      ownerId: tenantId,
      payload: { flagKey, enabled },
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    }),
  );
}

function relay(): OutboxRelay<Tables> {
  return new OutboxRelay({ db: relayDb, schema: SCHEMA, producer, serde });
}

async function drain(): Promise<number> {
  let total = 0;
  for (;;) {
    const published = await relay().runOnce();
    total += published;
    if (published === 0) return total;
  }
}

async function collect(
  topics: string[],
): Promise<{ consumer: Consumer; messages: { topic: string; message: KafkaMessage }[] }> {
  const messages: { topic: string; message: KafkaMessage }[] = [];
  const consumer = kafka.consumer({
    kafkaJS: { groupId: `collector-${newId()}`, fromBeginning: true },
  });
  await consumer.connect();
  await consumer.subscribe({ topics });
  await consumer.run({
    eachMessage: ({ topic, message }) => {
      messages.push({ topic, message });
      return Promise.resolve();
    },
  });
  cleanups.push(() => consumer.disconnect());
  return { consumer, messages };
}

async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('timed out');
}

const header = (message: KafkaMessage, name: string) => message.headers?.[name]?.toString();

describe('outbox relay', () => {
  it('publishes outbox rows with the decided key, headers and Avro envelope', async () => {
    const flagKey = `relay-${newId()}`;
    const eventA = await writeFlagEvent(tenantA, flagKey);
    const eventB = await writeFlagEvent(tenantB, flagKey);
    const { messages } = await collect([TOPIC]);
    expect(await drain()).toBeGreaterThanOrEqual(2);

    const received = await waitFor(() => {
      const mine = messages.filter((entry) =>
        [eventA, eventB].includes(header(entry.message, 'eventId') ?? ''),
      );
      return mine.length === 2 ? mine : undefined;
    });
    for (const { message } of received) {
      const eventId = header(message, 'eventId') ?? '';
      const tenantId = eventId === eventA ? tenantA : tenantB;
      expect(message.key?.toString()).toBe(`${tenantId}:${tenantId}`);
      expect(header(message, 'tenantId')).toBe(tenantId);
      expect(header(message, 'type')).toBe('flag.changed');
      expect(header(message, 'traceparent')).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
      const envelope = await serde.deserialize(
        TOPIC,
        'flag.changed',
        message.value ?? Buffer.alloc(0),
      );
      expect(envelope).toMatchObject({
        eventId,
        tenantId,
        type: 'flag.changed',
        version: 1,
        producer: 'kafka-test',
        traceId: '0af7651916cd43dd8448eb211c80319c',
        subject: { type: 'feature_flag' },
        data: { flagKey, enabled: true },
      });
    }
    const unpublished = await admin
      .withSchema(SCHEMA)
      .selectFrom('outbox_events')
      .select('id')
      .where('id', 'in', [eventA, eventB])
      .where('published_at', 'is', null)
      .execute();
    expect(unpublished).toHaveLength(0);
    expect(await relay().runOnce()).toBe(0);
  });

  it('never publishes a row twice when relays run concurrently', async () => {
    for (let index = 0; index < 60; index += 1) {
      await writeFlagEvent(index % 2 ? tenantA : tenantB, `concurrent-${String(index)}`);
    }
    const counts = await Promise.all([drain(), drain(), drain()]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(60);
  });

  it('refuses events that do not match their registered schema and leaves them unpublished', async () => {
    const bad = await writeFlagEvent(tenantA, `bad-${newId()}`, 'not-a-boolean');
    await expect(relay().runOnce()).rejects.toBeInstanceOf(SchemaValidationError);
    const row = await admin
      .withSchema(SCHEMA)
      .selectFrom('outbox_events')
      .select('published_at')
      .where('id', '=', bad)
      .executeTakeFirstOrThrow();
    expect(row.published_at).toBeNull();
    await admin.withSchema(SCHEMA).deleteFrom('outbox_events').where('id', '=', bad).execute();
  });
});

describe('schema registry', () => {
  it('rejects a backward-incompatible schema change', async () => {
    const subject = subjectName(TOPIC, 'flag.changed');
    const entry = catalog.get(TOPIC, 'flag.changed');
    const schema = structuredClone(entry.schema) as { fields: { name: string; type: unknown }[] };
    const data = schema.fields.find((field) => field.name === 'data') as {
      type: { fields: object[] };
    };
    data.type.fields.push({ name: 'requiredWithoutDefault', type: 'string' });
    const response = await fetch(
      `${registryUrl}/subjects/${encodeURIComponent(subject)}/versions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.schemaregistry.v1+json' },
        body: JSON.stringify({ schema: JSON.stringify(schema) }),
      },
    );
    expect(response.status).toBe(409);
  });

  it('accepts a backward-compatible change with a default', async () => {
    const subject = subjectName(TOPIC, 'flag.changed');
    const entry = catalog.get(TOPIC, 'flag.changed');
    const schema = structuredClone(entry.schema) as { fields: { name: string; type: unknown }[] };
    const data = schema.fields.find((field) => field.name === 'data') as {
      type: { fields: object[] };
    };
    data.type.fields.push({ name: 'reason', type: ['null', 'string'], default: null });
    const response = await fetch(
      `${registryUrl}/compatibility/subjects/${encodeURIComponent(subject)}/versions/latest`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.schemaregistry.v1+json' },
        body: JSON.stringify({ schema: JSON.stringify(schema) }),
      },
    );
    expect(await response.json()).toEqual({ is_compatible: true });
  });
});

describe('event consumer', () => {
  function startConsumer(
    handler: (flagKey: string, eventId: string) => Promise<void>,
    retryDelaysMs: [number, number] = [300, 300],
  ): EventConsumer<Tables> {
    const consumer = new EventConsumer<Tables>({
      kafka,
      producer,
      groupId: `consumer-${newId()}`,
      topic: TOPIC,
      db: app,
      schema: SCHEMA,
      serde,
      retryDelaysMs,
      handlers: {
        'flag.changed': async (envelope, trx) => {
          const data = envelope.data as { flagKey: string };
          await handler(data.flagKey, envelope.eventId);
          await trx
            .withSchema(SCHEMA)
            .insertInto('flag_views')
            .values({
              id: newId(),
              tenant_id: envelope.tenantId,
              flag_key: data.flagKey,
              event_id: envelope.eventId,
            })
            .execute();
        },
      },
    });
    cleanups.push(() => consumer.stop());
    return consumer;
  }

  const views = (tenantId: string, flagKey: string) =>
    withTenant(app, tenantId, (trx) =>
      trx
        .withSchema(SCHEMA)
        .selectFrom('flag_views')
        .select(['event_id'])
        .where('flag_key', '=', flagKey)
        .execute(),
    );

  it('handles each event once per tenant even when it is delivered twice', async () => {
    const flagKey = `dedupe-${newId()}`;
    let calls = 0;
    const consumer = startConsumer((key) => {
      if (key === flagKey) calls += 1;
      return Promise.resolve();
    });
    await consumer.start();
    try {
      const { messages } = await collect([TOPIC]);
      const eventId = await writeFlagEvent(tenantA, flagKey);
      await drain();
      const original = await waitFor(() =>
        messages.find((entry) => header(entry.message, 'eventId') === eventId),
      );
      await producer.send({
        topic: TOPIC,
        messages: [
          {
            key: original.message.key ?? null,
            value: original.message.value,
            headers: { eventId, tenantId: tenantA, type: 'flag.changed' },
          },
        ],
      });
      await waitFor(async () => ((await views(tenantA, flagKey)).length === 1 ? true : undefined));
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(await views(tenantA, flagKey)).toEqual([{ event_id: eventId }]);
      expect(calls).toBe(1);
      expect(await views(tenantB, flagKey)).toEqual([]);
    } finally {
      await consumer.stop();
    }
  });

  it('retries a failing handler and succeeds on the first retry', async () => {
    const flagKey = `retry-${newId()}`;
    let attempts = 0;
    const consumer = startConsumer((key) => {
      if (key !== flagKey) return Promise.resolve();
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('transient failure')) : Promise.resolve();
    });
    await consumer.start();
    try {
      await writeFlagEvent(tenantA, flagKey);
      await drain();
      await waitFor(async () => ((await views(tenantA, flagKey)).length === 1 ? true : undefined));
      expect(attempts).toBe(2);
    } finally {
      await consumer.stop();
    }
  });

  it(
    'moves a poison event through both retry topics to the DLQ',
    { timeout: 120_000 },
    async () => {
      const flagKey = `poison-${newId()}`;
      let attempts = 0;
      const consumer = startConsumer((key) => {
        if (key !== flagKey) return Promise.resolve();
        attempts += 1;
        return Promise.reject(new Error('permanent failure'));
      });
      await consumer.start();
      try {
        const { messages } = await collect([`${TOPIC}.dlq`]);
        const eventId = await writeFlagEvent(tenantA, flagKey);
        await drain();
        const dead = await waitFor(
          () => messages.find((entry) => header(entry.message, 'eventId') === eventId),
          90_000,
        );
        expect(header(dead.message, 'retry-attempt')).toBe('3');
        expect(header(dead.message, 'last-error')).toContain('permanent failure');
        expect(attempts).toBe(3);
        expect(await views(tenantA, flagKey)).toEqual([]);
      } finally {
        await consumer.stop();
      }
    },
  );
});

describe('tenant isolation of consumed state', () => {
  it('writes handler side effects under the event tenant only', async () => {
    const count = await sql<{ n: string }>`SELECT count(*) AS n FROM kdemo.flag_views`.execute(app);
    expect(Number(count.rows[0]?.n)).toBe(0);
  });
});
