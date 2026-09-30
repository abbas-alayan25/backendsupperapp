import type { Transaction } from 'kysely';
import type { StdTables } from './std-tables.js';

export const OUTBOX_RETENTION_DAYS = 7;
export const INBOX_RETENTION_DAYS = 31;

export interface PurgeResult {
  idempotencyKeys: number;
  outboxEvents: number;
  inboxEvents: number;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export async function purgeStdTables<DB>(
  trx: Transaction<DB>,
  schema: string,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const db = (trx as unknown as Transaction<StdTables>).withSchema(schema);
  const idempotency = await db
    .deleteFrom('idempotency_keys')
    .where('expires_at', '<', now)
    .executeTakeFirst();
  const outbox = await db
    .deleteFrom('outbox_events')
    .where('published_at', '<', daysBefore(now, OUTBOX_RETENTION_DAYS))
    .executeTakeFirst();
  const inbox = await db
    .deleteFrom('inbox_events')
    .where('processed_at', '<', daysBefore(now, INBOX_RETENTION_DAYS))
    .executeTakeFirst();
  return {
    idempotencyKeys: Number(idempotency.numDeletedRows),
    outboxEvents: Number(outbox.numDeletedRows),
    inboxEvents: Number(inbox.numDeletedRows),
  };
}
