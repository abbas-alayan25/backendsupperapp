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

export class OutboxWriter {
  constructor(
    private readonly schema: string,
    private readonly producer: string,
  ) {}

  async write(trx: Transaction<unknown>, event: OutboxEvent): Promise<string> {
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
    const id = newId();
    const headers: Record<string, string> = {};
    if (event.traceparent) {
      headers.traceparent = event.traceparent;
    }
    await (trx as unknown as Transaction<StdTables>)
      .withSchema(this.schema)
      .insertInto('outbox_events')
      .values({
        id,
        tenant_id: tenantId,
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
        event_type: event.eventType,
        event_version: event.eventVersion,
        producer: this.producer,
        topic: event.topic,
        message_key: messageKey(tenantId, event.ownerId),
        payload: JSON.stringify(event.payload),
        headers: JSON.stringify(headers),
        published_at: null,
      })
      .execute();
    return id;
  }
}
