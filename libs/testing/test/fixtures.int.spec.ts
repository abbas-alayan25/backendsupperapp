import { newId } from '@super-app/common';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type PostgresFixture,
  checkTenantIsolation,
  isIsolated,
  startKafka,
  startPostgres,
  startRedis,
  startTemporal,
  twoTenants,
} from '../src/index.js';

describe('postgres fixture and isolation checker', () => {
  let postgres: PostgresFixture;
  let appPool: pg.Pool;
  const { tenantA, tenantB } = twoTenants();

  beforeAll(async () => {
    postgres = await startPostgres();
    await postgres.admin.query(`
      CREATE ROLE fixture_app LOGIN PASSWORD 'fixture' NOBYPASSRLS;
      CREATE SCHEMA fixture;
      GRANT USAGE ON SCHEMA fixture TO fixture_app;
      CREATE TABLE fixture.protected (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL);
      CREATE TABLE fixture.open (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL);
      ALTER TABLE fixture.protected ENABLE ROW LEVEL SECURITY;
      ALTER TABLE fixture.protected FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON fixture.protected
        USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
      GRANT SELECT, INSERT, UPDATE, DELETE ON fixture.protected, fixture.open TO fixture_app;
    `);
    appPool = new pg.Pool({
      connectionString: postgres.uri({ user: 'fixture_app', password: 'fixture' }),
    });
  });

  afterAll(async () => {
    await appPool.end();
    await postgres.stop();
  });

  const insertInto = (table: string) => async (client: pg.PoolClient, tenantId: string) => {
    const id = newId();
    await client.query(`INSERT INTO ${table} (id, tenant_id, name) VALUES ($1, $2, 'row')`, [
      id,
      tenantId,
    ]);
    return id;
  };

  it('has the platform extensions', async () => {
    const result = await postgres.admin.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pgcrypto', 'pg_partman') ORDER BY 1",
    );
    expect(result.rows.map((row) => row.extname)).toEqual(['pg_partman', 'pgcrypto', 'postgis']);
  });

  it('passes a table protected by forced RLS', async () => {
    const report = await checkTenantIsolation({
      pool: appPool,
      table: 'fixture.protected',
      tenantA,
      tenantB,
      insertRow: insertInto('fixture.protected'),
    });
    expect(report).toEqual({
      ownerSeesRow: true,
      otherTenantSeesRow: false,
      otherTenantUpdated: 0,
      otherTenantDeleted: 0,
      crossTenantInsertBlocked: true,
      noTenantSeesRows: true,
    });
    expect(isIsolated(report)).toBe(true);
  });

  it('fails a table without RLS', async () => {
    const report = await checkTenantIsolation({
      pool: appPool,
      table: 'fixture.open',
      tenantA,
      tenantB,
      insertRow: insertInto('fixture.open'),
    });
    expect(report.otherTenantSeesRow).toBe(true);
    expect(report.crossTenantInsertBlocked).toBe(false);
    expect(isIsolated(report)).toBe(false);
  });

  it('creates extra databases with the platform extensions and no data', async () => {
    const uri = await postgres.createDatabase('fixture_copy');
    const client = new pg.Client({ connectionString: uri });
    await client.connect();
    const extensions = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pgcrypto', 'pg_partman') ORDER BY 1",
    );
    const schemas = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'fixture'");
    await client.end();
    expect(extensions.rows.map((row) => row.extname)).toEqual([
      'pg_partman',
      'pgcrypto',
      'postgis',
    ]);
    expect(schemas.rowCount).toBe(0);
  });

  it('rejects unsafe table names', async () => {
    await expect(
      checkTenantIsolation({
        pool: appPool,
        table: 'fixture.protected; DROP TABLE x',
        tenantA,
        tenantB,
        insertRow: insertInto('fixture.protected'),
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('redis fixture', () => {
  it('starts and answers PING', async () => {
    const redis = await startRedis();
    const response = await redis.container.executeCliCmd('PING');
    await redis.stop();
    expect(response.trim()).toBe('PONG');
  });
});

describe('kafka fixture', () => {
  it('starts a broker with a schema registry', async () => {
    const kafka = await startKafka({ schemaRegistry: true });
    try {
      expect(kafka.bootstrapServers).toMatch(/^127\.0\.0\.1:\d+$/);
      const response = await fetch(`${kafka.schemaRegistryUrl ?? ''}/subjects`);
      expect(response.status).toBe(200);
    } finally {
      await kafka.stop();
    }
  });
});

describe('temporal fixture', () => {
  it('starts a dev server with the tenantId search attribute', async () => {
    const temporal = await startTemporal();
    try {
      const result = await temporal.container.exec([
        'temporal',
        'operator',
        'search-attribute',
        'list',
        '--address',
        'localhost:7233',
      ]);
      expect(result.output).toContain('tenantId');
    } finally {
      await temporal.stop();
    }
  });
});
