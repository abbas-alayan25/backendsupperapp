import { describe, expect, it } from 'vitest';
import { EventCatalog, UnknownEventTypeError, recordName, subjectName } from './catalog.js';
import { failureRoute } from './consumer.js';
import { envelopeFromOutbox, traceIdFromTraceparent } from './envelope.js';
import {
  AvroEventSerde,
  type SchemaInfoLike,
  type SchemaRegistryPort,
  SchemaValidationError,
  WireFormatError,
  registerCatalog,
} from './serde.js';
import { topicConfigs } from './topics-admin.js';

class MemoryRegistry implements SchemaRegistryPort {
  private readonly bySubject = new Map<string, Map<string, number>>();
  private readonly byId = new Map<number, SchemaInfoLike>();
  private nextId = 1;

  register(subject: string, schema: SchemaInfoLike): Promise<number> {
    const versions = this.bySubject.get(subject) ?? new Map<string, number>();
    const existing = versions.get(schema.schema);
    if (existing !== undefined) return Promise.resolve(existing);
    const id = this.nextId++;
    versions.set(schema.schema, id);
    this.bySubject.set(subject, versions);
    this.byId.set(id, schema);
    return Promise.resolve(id);
  }

  getId(subject: string, schema: SchemaInfoLike): Promise<number> {
    const id = this.bySubject.get(subject)?.get(schema.schema);
    return id === undefined ? Promise.reject(new Error('Schema not found')) : Promise.resolve(id);
  }

  getBySubjectAndId(_subject: string, id: number): Promise<SchemaInfoLike> {
    const schema = this.byId.get(id);
    return schema ? Promise.resolve(schema) : Promise.reject(new Error('Schema not found'));
  }
}

const catalog = () =>
  new EventCatalog([
    {
      topic: 'platform.config',
      eventType: 'flag.changed',
      dataFields: [
        { name: 'flagKey', type: 'string' },
        { name: 'enabled', type: 'boolean' },
      ],
    },
  ]);

const envelope = {
  eventId: '0192f5a0-0000-7000-8000-000000000010',
  tenantId: '0192f5a0-0000-7000-8000-000000000001',
  type: 'flag.changed',
  version: 1,
  occurredAt: '2026-09-30T10:00:00.000Z',
  producer: 'platform-service',
  traceId: null,
  subject: { type: 'feature_flag', id: '0192f5a0-0000-7000-8000-000000000020' },
  data: { flagKey: 'p2p', enabled: true },
};

describe('naming', () => {
  it('derives record and subject names with TopicRecordNameStrategy', () => {
    expect(recordName('kyc.applications', 'kyc_application.approved')).toBe(
      'superapp.events.kyc.KycApplicationApproved',
    );
    expect(subjectName('payments.payments', 'payment.completed')).toBe(
      'payments.payments-superapp.events.payments.PaymentCompleted',
    );
  });

  it('rejects unknown topics, bad event names and duplicates', () => {
    const c = catalog();
    expect(() =>
      c.add({ topic: 'nope.nope' as 'platform.config', eventType: 'a.b', dataFields: [] }),
    ).toThrow(RangeError);
    expect(() =>
      c.add({ topic: 'platform.config', eventType: 'FlagChanged', dataFields: [] }),
    ).toThrow(RangeError);
    expect(() =>
      c.add({ topic: 'platform.config', eventType: 'flag.changed', dataFields: [] }),
    ).toThrow(RangeError);
    expect(() => c.get('platform.config', 'screen.published')).toThrow(UnknownEventTypeError);
  });
});

describe('envelope', () => {
  it('extracts the trace id from a W3C traceparent', () => {
    expect(traceIdFromTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')).toBe(
      '0af7651916cd43dd8448eb211c80319c',
    );
    expect(traceIdFromTraceparent(undefined)).toBeNull();
    expect(traceIdFromTraceparent('garbage')).toBeNull();
    expect(traceIdFromTraceparent(`00-${'0'.repeat(32)}-b7ad6b7169203331-01`)).toBeNull();
  });

  it('builds the decided envelope from an outbox row', () => {
    const created = new Date('2026-09-30T10:00:00.000Z');
    expect(
      envelopeFromOutbox({
        id: envelope.eventId,
        tenant_id: envelope.tenantId,
        created_at: created,
        aggregate_type: 'feature_flag',
        aggregate_id: envelope.subject.id,
        event_type: 'flag.changed',
        event_version: 1,
        producer: 'platform-service',
        topic: 'platform.config',
        message_key: 'k',
        payload: envelope.data,
        headers: {},
      }),
    ).toEqual(envelope);
  });
});

describe('AvroEventSerde', () => {
  it('round-trips an event in the Confluent wire format', async () => {
    const registry = new MemoryRegistry();
    const c = catalog();
    const ids = await registerCatalog(registry, c);
    const serde = new AvroEventSerde(registry, c);
    const bytes = await serde.serialize('platform.config', envelope);
    expect(bytes.readUInt8(0)).toBe(0);
    expect(bytes.readInt32BE(1)).toBe(ids.get(subjectName('platform.config', 'flag.changed')));
    expect(await serde.deserialize('platform.config', 'flag.changed', bytes)).toEqual(envelope);
  });

  it('rejects events that do not match the schema', async () => {
    const registry = new MemoryRegistry();
    const c = catalog();
    await registerCatalog(registry, c);
    const serde = new AvroEventSerde(registry, c);
    await expect(
      serde.serialize('platform.config', { ...envelope, data: { flagKey: 'p2p', enabled: 'yes' } }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it('refuses unregistered schemas', async () => {
    const serde = new AvroEventSerde(new MemoryRegistry(), catalog());
    await expect(serde.serialize('platform.config', envelope)).rejects.toThrow('Schema not found');
  });

  it('rejects bytes without the magic byte', async () => {
    const serde = new AvroEventSerde(new MemoryRegistry(), catalog());
    await expect(
      serde.deserialize('platform.config', 'flag.changed', Buffer.from([1, 2])),
    ).rejects.toBeInstanceOf(WireFormatError);
  });
});

describe('failure routing', () => {
  it('moves from the topic to retry.1m, retry.10m and the DLQ', () => {
    expect(failureRoute('payments.payments', 0, 1000)).toEqual({
      topic: 'payments.payments.retry.1m',
      notBefore: 61_000,
      attempt: 1,
    });
    expect(failureRoute('payments.payments', 1, 1000)).toEqual({
      topic: 'payments.payments.retry.10m',
      notBefore: 601_000,
      attempt: 2,
    });
    expect(failureRoute('payments.payments', 2, 1000)).toEqual({
      topic: 'payments.payments.dlq',
      notBefore: undefined,
      attempt: 3,
    });
  });
});

describe('topic provisioning', () => {
  it('creates each topic with its retry and dead-letter topics', () => {
    const configs = topicConfigs(['tenancy.tenants'], {
      replicationFactor: 3,
      minInsyncReplicas: 2,
    });
    expect(configs.map((config) => config.topic)).toEqual([
      'tenancy.tenants',
      'tenancy.tenants.retry.1m',
      'tenancy.tenants.retry.10m',
      'tenancy.tenants.dlq',
    ]);
    expect(configs[0]).toMatchObject({ numPartitions: 6, replicationFactor: 3 });
    expect(configs[0]?.configEntries).toEqual(
      expect.arrayContaining([
        { name: 'min.insync.replicas', value: '2' },
        { name: 'retention.ms', value: String(30 * 86_400_000) },
        { name: 'cleanup.policy', value: 'compact,delete' },
      ]),
    );
    expect(configs[3]?.configEntries).toContainEqual({ name: 'cleanup.policy', value: 'delete' });
  });
});
