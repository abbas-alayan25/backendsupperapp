import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error.js';
import {
  TENANT_PROFILE_SCHEMA,
  type TenantProfileDocument,
  assertTenantProfile,
  validateTenantProfile,
} from './tenant-profile.js';

interface MutableProfile {
  brand: Record<string, unknown>;
  market: Record<string, unknown>;
  adapters: Record<string, unknown>;
  compliance: {
    kycTiers: { tier: number; requiresTier?: number; limits: { currency: string }[] }[];
    cardIssuance: Record<string, number>;
  };
}

const example = (): MutableProfile =>
  structuredClone(
    (TENANT_PROFILE_SCHEMA.examples as TenantProfileDocument[])[0],
  ) as unknown as MutableProfile;

function issues(document: unknown): string[] {
  const result = validateTenantProfile(document);
  return result.valid ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

describe('validateTenantProfile', () => {
  it('accepts the schema example', () => {
    expect(issues(example())).toEqual([]);
  });

  it('reports schema errors with paths', () => {
    const document = example();
    delete document.brand.name;
    expect(issues(document).some((issue) => issue.startsWith('/brand'))).toBe(true);
  });

  it('requires the default currency and locale to be enabled', () => {
    const document = example();
    document.market.defaultCurrency = 'EUR';
    document.market.defaultLocale = 'en';
    document.market.locales = ['ar'];
    expect(issues(document)).toEqual(
      expect.arrayContaining([
        '/market/defaultCurrency: currency EUR is not in market.currencies',
        '/market/defaultLocale: defaultLocale is not in market.locales',
      ]),
    );
  });

  it('requires tiers to be unique and contiguous from 0', () => {
    const document = example();
    document.compliance.kycTiers = document.compliance.kycTiers.filter((tier) => tier.tier !== 1);
    expect(issues(document)).toContain(
      '/compliance/kycTiers: tiers must be unique and contiguous from 0',
    );
  });

  it('requires limit currencies to be market currencies', () => {
    const document = example();
    const limit = document.compliance.kycTiers[1]?.limits[0];
    if (limit) limit.currency = 'JOD';
    expect(issues(document)).toContain(
      '/compliance/kycTiers/1/limits/0/currency: currency JOD is not in market.currencies',
    );
  });

  it('requires card issuance tiers to exist', () => {
    const document = example();
    document.compliance.cardIssuance = { virtualMinTier: 1, physicalMinTier: 3 };
    expect(issues(document)).toContain(
      '/compliance/cardIssuance/physicalMinTier: tier is not defined in kycTiers',
    );
  });

  it('requires a card issuer when cards are enabled', () => {
    const document = example();
    delete document.adapters.cardIssuer;
    expect(issues(document).length).toBeGreaterThan(0);
  });

  it('throws VALIDATION_FAILED with the issues', () => {
    const document = example();
    document.market.defaultCurrency = 'EUR';
    try {
      assertTenantProfile(document);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({ reason: 'INVALID_TENANT_PROFILE' });
    }
  });
});
