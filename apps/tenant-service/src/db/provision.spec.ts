import { describe, expect, it } from 'vitest';
import { provisionSql } from './provision.js';

describe('login role provisioning', () => {
  it('creates the app, sync and relay login roles with only the relay bypassing RLS', () => {
    const sql = provisionSql({ TENANCY_APP_PASSWORD: 'a', TENANCY_SYNC_PASSWORD: 'b', TENANCY_RELAY_PASSWORD: 'c' });
    expect(sql).toContain("CREATE ROLE tenant_service LOGIN NOBYPASSRLS PASSWORD 'a'");
    expect(sql).toContain('GRANT tenancy_app TO tenant_service;');
    expect(sql).toContain("CREATE ROLE tenant_service_sync LOGIN NOBYPASSRLS PASSWORD 'b'");
    expect(sql).toContain('GRANT tenancy_sync TO tenant_service_sync;');
    expect(sql).toContain("CREATE ROLE tenant_service_relay LOGIN BYPASSRLS PASSWORD 'c'");
  });

  it('requires passwords in production', () => {
    expect(() => provisionSql({ NODE_ENV: 'production' })).toThrow(/TENANCY_APP_PASSWORD/);
  });
});
