import { newId, requireTenantId } from '@super-app/common';
import { type Transaction, sql } from 'kysely';
import { ident, qualified } from './sql/identifiers.js';

export interface KeyTableTarget {
  readonly schema: string;
  readonly table: string;
  readonly refColumn: string;
  readonly key: Readonly<Record<string, string | number>>;
  readonly tenantId?: string;
}

export interface KeyedResult<T> {
  readonly created: boolean;
  readonly id: string;
  readonly value: T;
}

export async function insertWithKey<DB, T>(
  trx: Transaction<DB>,
  target: KeyTableTarget,
  create: (id: string) => Promise<T>,
  load: (id: string) => Promise<T>,
): Promise<KeyedResult<T>> {
  const tenantId = target.tenantId ?? requireTenantId();
  const table = sql.raw(qualified(target.schema, target.table));
  const refColumn = sql.ref(ident(target.refColumn));
  const keyNames = Object.keys(target.key).map(ident);
  if (keyNames.length === 0) {
    throw new RangeError('insertWithKey needs at least one key column');
  }
  const id = newId();
  const columns = sql.join([
    sql.ref('tenant_id'),
    ...keyNames.map((name) => sql.ref(name)),
    refColumn,
  ]);
  const values = sql.join([tenantId, ...keyNames.map((name) => target.key[name]), id]);
  const inserted = await sql<{ ref: string }>`
    INSERT INTO ${table} (${columns}) VALUES (${values})
    ON CONFLICT DO NOTHING
    RETURNING ${refColumn} AS ref
  `.execute(trx);
  if (inserted.rows.length === 1) {
    return { created: true, id, value: await create(id) };
  }
  const conditions = sql.join(
    [
      sql`tenant_id = ${tenantId}`,
      ...keyNames.map((name) => sql`${sql.ref(name)} = ${target.key[name]}`),
    ],
    sql` AND `,
  );
  const existing = await sql<{ ref: string }>`
    SELECT ${refColumn} AS ref FROM ${table} WHERE ${conditions}
  `.execute(trx);
  const existingId = existing.rows[0]?.ref;
  if (existingId === undefined) {
    throw new Error(`Key conflict on ${target.table} but no existing row is visible`);
  }
  return { created: false, id: existingId, value: await load(existingId) };
}
