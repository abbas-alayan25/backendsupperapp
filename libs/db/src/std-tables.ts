import type { ColumnType, Generated } from 'kysely';

export interface OutboxEventsTable {
  id: string;
  tenant_id: string;
  created_at: Generated<Date>;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  event_version: number;
  producer: string;
  topic: string;
  message_key: string;
  payload: ColumnType<unknown, string, string>;
  headers: ColumnType<Record<string, string>, string, string>;
  published_at: Date | null;
}

export interface IdempotencyKeysTable {
  id: string;
  tenant_id: string;
  created_at: Generated<Date>;
  key: string;
  actor_type: 'USER' | 'API_KEY' | 'ADMIN' | 'SERVICE';
  actor_id: string;
  request_hash: string;
  response_code: number | null;
  response_body: ColumnType<unknown, string | null, string | null>;
  locked_until: Date | null;
  expires_at: Date;
}

export interface InboxEventsTable {
  id: string;
  tenant_id: string;
  created_at: Generated<Date>;
  event_id: string;
  topic: string;
  processed_at: Generated<Date>;
}

export interface StdTables {
  outbox_events: OutboxEventsTable;
  idempotency_keys: IdempotencyKeysTable;
  inbox_events: InboxEventsTable;
}
