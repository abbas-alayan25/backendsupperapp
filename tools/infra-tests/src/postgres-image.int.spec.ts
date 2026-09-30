import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const IMAGE = 'super-app/postgres:infra-test';
const CONTEXT = fileURLToPath(new URL('../../../infra/docker/postgres', import.meta.url));

describe('project Postgres image', () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;

  beforeAll(async () => {
    await GenericContainer.fromDockerfile(CONTEXT).build(IMAGE, { deleteOnExit: false });
    container = await new PostgreSqlContainer(IMAGE).withDatabase('superapp').start();
    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await container.stop();
  });

  it('has postgis, pgcrypto and pg_partman installed', async () => {
    const result = await client.query<{ extname: string; nspname: string }>(
      `SELECT e.extname, n.nspname
         FROM pg_extension e
         JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = ANY($1)
        ORDER BY e.extname`,
      [['pg_partman', 'pgcrypto', 'postgis']],
    );
    expect(result.rows).toEqual([
      { extname: 'pg_partman', nspname: 'partman' },
      { extname: 'pgcrypto', nspname: 'public' },
      { extname: 'postgis', nspname: 'public' },
    ]);
  });

  it('runs PostgreSQL 18', async () => {
    const result = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    expect(Number(result.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(180000);
  });

  it('enables logical replication for Debezium', async () => {
    const result = await client.query<{ wal_level: string }>('SHOW wal_level');
    expect(result.rows[0]?.wal_level).toBe('logical');
  });

  it('supports the features the platform relies on', async () => {
    const geo = await client.query<{ meters: number }>(
      `SELECT ST_Distance('SRID=4326;POINT(35.9106 31.9539)'::geography,
                          'SRID=4326;POINT(35.9300 31.9600)'::geography) AS meters`,
    );
    expect(geo.rows[0]?.meters).toBeGreaterThan(1000);
    const uuid = await client.query<{ id: string }>('SELECT gen_random_uuid()::text AS id');
    expect(uuid.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
