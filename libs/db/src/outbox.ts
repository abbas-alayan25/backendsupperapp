import {
  isEventType,
  isTopic,
  isUuid,
  messageKey,
  newId,
  requireTenantId,
  type Topic,
} from '@super-app/common';
import type { Transaction } from 'kysely';
import type { PrismaTransactionClient } from './prisma.js';
import { qualified } from './sql/identifiers.js';
import type { StdTables } from './std-tables.js';

export interface OutboxEvent {
  readonly topic: Topic;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly ownerId: string;
  readonly payload: unknown;
  readonly tenantId?: string;
  readonly traceparent?: string;
}

export class InvalidOutboxEventError extends Error {
  constructor(reason: string) {
    super(`Invalid outbox event: ${reason}`);
    this.name = 'InvalidOutboxEventError';
  }
}

export interface OutboxRow {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  event_version: number;
  producer: string;
  topic: string;
  message_key: string;
  payload: string;
  headers: string;
  published_at: null;
}

export function buildOutboxRow(producer: string, event: OutboxEvent): OutboxRow {
  if (!isTopic(event.topic)) {
    throw new InvalidOutboxEventError(`unknown topic ${String(event.topic)}`);
  }
  if (!isEventType(event.eventType)) {
    throw new InvalidOutboxEventError(`event type ${event.eventType} is not <aggregate>.<verb>`);
  }
  if (!Number.isInteger(event.eventVersion) || event.eventVersion < 1) {
    throw new InvalidOutboxEventError('event version must be a positive integer');
  }
  if (!isUuid(event.aggregateId)) {
    throw new InvalidOutboxEventError('aggregate id must be a UUID');
  }
  const tenantId = event.tenantId ?? requireTenantId();
  const headers: Record<string, string> = {};
  if (event.traceparent) {
    headers.traceparent = event.traceparent;
  }
  return {
    id: newId(),
    tenant_id: tenantId,
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    event_type: event.eventType,
    event_version: event.eventVersion,
    producer,
    topic: event.topic,
    message_key: messageKey(tenantId, event.ownerId),
    payload: JSON.stringify(event.payload),
    headers: JSON.stringify(headers),
    published_at: null,
  };
}

export class OutboxWriter {
  constructor(
    private readonly schema: string,
    private readonly producer: string,
  ) {}

  async write<DB>(trx: Transaction<DB>, event: OutboxEvent): Promise<string> {
    const row = buildOutboxRow(this.producer, event);
    await (trx as unknown as Transaction<StdTables>)
      .withSchema(this.schema)
      .insertInto('outbox_events')
      .values(row)
      .execute();
    return row.id;
  }

  async writePrisma(tx: PrismaTransactionClient, event: OutboxEvent): Promise<string> {
    const row = buildOutboxRow(this.producer, event);
    await tx.$executeRawUnsafe(
      `INSERT INTO ${qualified(this.schema, 'outbox_events')}
        (id, tenant_id, aggregate_type, aggregate_id, event_type, event_version, producer, topic, message_key, payload, headers)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      row.id,
      row.tenant_id,
      row.aggregate_type,
      row.aggregate_id,
      row.event_type,
      row.event_version,
      row.producer,
      row.topic,
      row.message_key,
      row.payload,
      row.headers,
    );
    return row.id;
  }
}
