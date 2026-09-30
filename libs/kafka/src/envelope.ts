export interface EventSubject {
  readonly type: string;
  readonly id: string;
}

export interface EventEnvelope<T = unknown> {
  readonly eventId: string;
  readonly tenantId: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly producer: string;
  readonly traceId: string | null;
  readonly subject: EventSubject;
  readonly data: T;
}

export interface OutboxRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly created_at: Date;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly producer: string;
  readonly topic: string;
  readonly message_key: string;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

export function traceIdFromTraceparent(traceparent: string | undefined): string | null {
  const match = traceparent ? TRACEPARENT.exec(traceparent) : null;
  const traceId = match?.[1];
  return traceId && traceId !== '0'.repeat(32) ? traceId : null;
}

export function envelopeFromOutbox(row: OutboxRow): EventEnvelope {
  return {
    eventId: row.id,
    tenantId: row.tenant_id,
    type: row.event_type,
    version: row.event_version,
    occurredAt: row.created_at.toISOString(),
    producer: row.producer,
    traceId: traceIdFromTraceparent(row.headers.traceparent),
    subject: { type: row.aggregate_type, id: row.aggregate_id },
    data: row.payload,
  };
}
