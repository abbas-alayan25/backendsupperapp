import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';

export const POSTGRES_TEST_IMAGE = 'super-app/postgres:testing';
const POSTGRES_CONTEXT = fileURLToPath(new URL('../../../infra/docker/postgres', import.meta.url));
const SUPERUSER = 'postgres';
const PLATFORM_EXTENSIONS_SQL = `CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;`;
const SUPERUSER_PASSWORD = 'postgres';

export interface PostgresFixture {
  readonly container: StartedPostgreSqlContainer;
  readonly admin: pg.Pool;
  uri(options?: { database?: string; user?: string; password?: string }): string;
  createDatabase(name: string): Promise<string>;
  stop(): Promise<void>;
}

let imageBuilt: Promise<unknown> | undefined;

export function buildPostgresImage(): Promise<unknown> {
  imageBuilt ??= GenericContainer.fromDockerfile(POSTGRES_CONTEXT).build(POSTGRES_TEST_IMAGE, {
    deleteOnExit: false,
  });
  return imageBuilt;
}

export async function startPostgres(database = 'superapp'): Promise<PostgresFixture> {
  await buildPostgresImage();
  const container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
    .withDatabase(database)
    .withUsername(SUPERUSER)
    .withPassword(SUPERUSER_PASSWORD)
    .start();
  const host = container.getHost();
  const port = container.getPort();
  const uri = (options: { database?: string; user?: string; password?: string } = {}) => {
    const user = encodeURIComponent(options.user ?? SUPERUSER);
    const password = encodeURIComponent(options.password ?? SUPERUSER_PASSWORD);
    return `postgres://${user}:${password}@${host}:${String(port)}/${options.database ?? database}`;
  };
  const admin = new pg.Pool({ connectionString: uri(), max: 4 });
  return {
    container,
    admin,
    uri,
    async createDatabase(name: string) {
      if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        throw new RangeError(`Invalid database name ${name}`);
      }
      await admin.query(`CREATE DATABASE ${name}`);
      const client = new pg.Client({ connectionString: uri({ database: name }) });
      await client.connect();
      try {
        await client.query(PLATFORM_EXTENSIONS_SQL);
      } finally {
        await client.end();
      }
      return uri({ database: name });
    },
    async stop() {
      await admin.end();
      await container.stop();
    },
  };
}
