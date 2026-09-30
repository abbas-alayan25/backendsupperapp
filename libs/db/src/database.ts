import { isUuid, requireTenantId } from '@super-app/common';
import { Kysely, PostgresDialect, type Transaction, sql } from 'kysely';
import pg from 'pg';

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly applicationName?: string;
}

export function createDatabase<DB>(options: DatabaseOptions): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    application_name: options.applicationName,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

export type TenantScope = 'tenant' | 'platform';

export class InvalidTenantError extends Error {
  constructor(value: string) {
    super(`Invalid tenant id ${value}`);
    this.name = 'InvalidTenantError';
  }
}

export async function applyTenantSettings<DB>(
  executor: Transaction<DB>,
  tenantId: string | null,
  scope: TenantScope = 'tenant',
): Promise<void> {
  if (tenantId !== null && !isUuid(tenantId)) {
    throw new InvalidTenantError(tenantId);
  }
  await sql`SELECT set_config('app.tenant_id', ${tenantId ?? ''}, true), set_config('app.scope', ${scope}, true)`.execute(
    executor,
  );
}

export function withTenant<DB, T>(
  db: Kysely<DB>,
  tenantId: string,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) {
    return Promise.reject(new InvalidTenantError(tenantId));
  }
  return db.transaction().execute(async (trx) => {
    await applyTenantSettings(trx, tenantId);
    return fn(trx);
  });
}

export function withPlatformScope<DB, T>(
  db: Kysely<DB>,
  tenantId: string | null,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await applyTenantSettings(trx, tenantId, 'platform');
    return fn(trx);
  });
}

export function inTenantTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return withTenant(db, requireTenantId(), fn);
}

export async function forEachTenant(
  tenantIds: readonly string[],
  fn: (tenantId: string) => Promise<void>,
): Promise<{ succeeded: string[]; failed: { tenantId: string; error: unknown }[] }> {
  const succeeded: string[] = [];
  const failed: { tenantId: string; error: unknown }[] = [];
  for (const tenantId of tenantIds) {
    try {
      await fn(tenantId);
      succeeded.push(tenantId);
    } catch (error) {
      failed.push({ tenantId, error });
    }
  }
  return { succeeded, failed };
}
