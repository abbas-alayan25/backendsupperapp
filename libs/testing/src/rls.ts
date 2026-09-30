import type pg from 'pg';

export interface IsolationOptions {
  readonly pool: pg.Pool;
  readonly table: string;
  readonly tenantA: string;
  readonly tenantB: string;
  insertRow(client: pg.PoolClient, tenantId: string): Promise<string>;
  readonly idColumn?: string;
}

export interface IsolationReport {
  ownerSeesRow: boolean;
  otherTenantSeesRow: boolean;
  otherTenantUpdated: number;
  otherTenantDeleted: number | 'denied';
  crossTenantInsertBlocked: boolean;
  noTenantSeesRows: boolean;
}

const TABLE_PATTERN = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

async function asTenant<T>(
  pool: pg.Pool,
  tenantId: string | undefined,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId !== undefined) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function committedAsTenant<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function checkTenantIsolation(options: IsolationOptions): Promise<IsolationReport> {
  if (!TABLE_PATTERN.test(options.table)) {
    throw new RangeError(`Invalid table ${options.table}`);
  }
  const idColumn = options.idColumn ?? 'id';
  const { pool, table, tenantA, tenantB } = options;
  const id = await committedAsTenant(pool, tenantA, (client) => options.insertRow(client, tenantA));
  const countById = (client: pg.PoolClient) =>
    client
      .query<{ count: string }>(`SELECT count(*) FROM ${table} WHERE ${idColumn} = $1`, [id])
      .then((result) => Number(result.rows[0]?.count ?? 0));

  const ownerSeesRow = (await asTenant(pool, tenantA, countById)) === 1;
  const otherTenantSeesRow = (await asTenant(pool, tenantB, countById)) > 0;
  const otherTenantUpdated = await asTenant(pool, tenantB, (client) =>
    client
      .query(`UPDATE ${table} SET tenant_id = tenant_id WHERE ${idColumn} = $1`, [id])
      .then((result) => result.rowCount ?? 0)
      .catch(() => 0),
  );
  const otherTenantDeleted = await asTenant(pool, tenantB, (client) =>
    client
      .query(`DELETE FROM ${table} WHERE ${idColumn} = $1`, [id])
      .then((result): number | 'denied' => result.rowCount ?? 0)
      .catch((): 'denied' => 'denied'),
  );
  const crossTenantInsertBlocked = await asTenant(pool, tenantB, (client) =>
    options
      .insertRow(client, tenantA)
      .then(() => false)
      .catch(() => true),
  );
  const noTenantSeesRows = await asTenant(pool, undefined, (client) =>
    client
      .query<{ count: string }>(`SELECT count(*) FROM ${table}`)
      .then((result) => Number(result.rows[0]?.count ?? 0) === 0),
  );
  return {
    ownerSeesRow,
    otherTenantSeesRow,
    otherTenantUpdated,
    otherTenantDeleted,
    crossTenantInsertBlocked,
    noTenantSeesRows,
  };
}

export function isIsolated(report: IsolationReport): boolean {
  return (
    report.ownerSeesRow &&
    !report.otherTenantSeesRow &&
    report.otherTenantUpdated === 0 &&
    (report.otherTenantDeleted === 0 || report.otherTenantDeleted === 'denied') &&
    report.crossTenantInsertBlocked &&
    report.noTenantSeesRows
  );
}
