import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tenancyMigrationSql } from './migration-sql.js';

const MIGRATION = new URL('../../prisma/migrations/0001_init/migration.sql', import.meta.url);
const TENANT_TABLES = [
  'tenant_profiles',
  'tenant_adapters',
  'tenant_domains',
  'tenant_deployments',
  'tenant_apps',
  'tenant_usage_daily',
  'outbox_events',
  'idempotency_keys',
  'inbox_events',
];

describe('tenancy migration', () => {
  const sql = tenancyMigrationSql();

  it('matches the committed Prisma migration', () => {
    expect(readFileSync(MIGRATION, 'utf8')).toBe(`${sql}\n`);
  });

  it('forces row level security on every tenant-scoped table', () => {
    for (const table of TENANT_TABLES) {
      expect(sql).toContain(`ALTER TABLE tenancy.${table} FORCE ROW LEVEL SECURITY;`);
    }
  });

  it('keeps tenants global and writable only by the sync role', () => {
    expect(sql).not.toContain('ALTER TABLE tenancy.tenants ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('GRANT SELECT ON tenancy.tenants TO tenancy_app;');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON tenancy.tenants TO tenancy_sync;');
    expect(sql).not.toMatch(/GRANT [A-Z, ]*(INSERT|UPDATE)[A-Z, ]* ON tenancy\.tenants TO tenancy_app/);
  });

  it('only grants DELETE on domains to the console write role', () => {
    const deletes = sql.split('\n').filter((line) => /GRANT [^;]*DELETE/.test(line) && !line.includes('_maint'));
    expect(deletes).toEqual(['GRANT DELETE ON tenancy.tenant_domains TO tenancy_sync;']);
  });

  it('creates every spec status check', () => {
    expect(sql).toContain("status text NOT NULL CHECK (status IN ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED'))");
    expect(sql).toContain("status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))");
    expect(sql).toContain("status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED'))");
    expect(sql).toContain("kind text NOT NULL CHECK (kind IN ('API', 'ADMIN', 'MERCHANT', 'WEB'))");
  });

  it('never creates a role with BYPASSRLS except the relay group role', () => {
    const bypass = sql.match(/CREATE ROLE (\w+) [A-Z ]*BYPASSRLS/g) ?? [];
    expect(bypass.filter((statement) => !statement.includes('NOBYPASSRLS'))).toEqual([
      'CREATE ROLE tenancy_relay NOLOGIN BYPASSRLS',
    ]);
  });
});
