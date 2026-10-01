import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tenancyMigrationSql } from './migration-sql.js';

export const MIGRATION_FILE = fileURLToPath(
  new URL('../../prisma/migrations/0001_init/migration.sql', import.meta.url),
);

writeFileSync(MIGRATION_FILE, `${tenancyMigrationSql()}\n`);
