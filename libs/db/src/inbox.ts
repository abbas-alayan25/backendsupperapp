import { newId, requireTenantId } from '@super-app/common';
import type { Transaction } from 'kysely';
import type { StdTables } from './std-tables.js';

export interface InboxTarget {
  readonly schema: string;
  readonly eventId: string;
  readonly topic: string;
  readonly tenantId?: string;
}

export async function processOnce<T>(
  trx: Transaction<unknown>,
  target: InboxTarget,
  handler: () => Promise<T>,
): Promise<{ processed: true; value: T } | { processed: false }> {
  const inserted = await (trx as unknown as Transaction<StdTables>)
    .withSchema(target.schema)
    .insertInto('inbox_events')
    .values({
      id: newId(),
      tenant_id: target.tenantId ?? requireTenantId(),
      event_id: target.eventId,
      topic: target.topic,
    })
    .onConflict((conflict) => conflict.columns(['tenant_id', 'event_id']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!inserted) {
    return { processed: false };
  }
  return { processed: true, value: await handler() };
}
