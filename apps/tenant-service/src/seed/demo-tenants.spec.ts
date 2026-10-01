import { validateTenantProfile } from '@super-app/common';
import { describe, expect, it } from 'vitest';
import { DEMO_TENANTS } from '../../../../tools/dev-seed/src/demo-tenants.js';
import { desiredAdapters } from '../profiles/profile-document.js';
import { DEMO_TENANT_SEEDS } from './demo-tenants.js';

describe('demo tenant seeds', () => {
  it('are valid tenant profiles', () => {
    for (const seed of DEMO_TENANT_SEEDS) {
      expect(validateTenantProfile(seed.profile)).toMatchObject({ valid: true });
      expect(seed.profile.market.country).toBe(seed.country);
    }
  });

  it('differ in country, currency, locale defaults and adapters', () => {
    const [acme, petra] = DEMO_TENANT_SEEDS;
    expect(acme?.country).not.toBe(petra?.country);
    expect(acme?.profile.market.currencies).not.toEqual(petra?.profile.market.currencies);
    expect(acme?.profile.market.timeZone).not.toBe(petra?.profile.market.timeZone);
    expect(acme?.profile.adapters).not.toEqual(petra?.profile.adapters);
  });

  it('match the Vault seed so every projected adapter has secrets', () => {
    for (const seed of DEMO_TENANT_SEEDS) {
      const vaultTenant = DEMO_TENANTS.find((tenant) => tenant.id === seed.id);
      expect(vaultTenant?.code).toBe(seed.code);
      const vaultPaths = new Set(
        (vaultTenant?.adapters ?? []).map(
          (adapter) => `tenants/${seed.id}/adapters/${adapter.partnerType}/${adapter.provider}`,
        ),
      );
      for (const adapter of desiredAdapters(seed.id, seed.profile.adapters)) {
        expect(vaultPaths.has(adapter.secretRef), adapter.secretRef).toBe(true);
      }
    }
  });
});
