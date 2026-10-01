import { AppError } from '@super-app/common';
import { describe, expect, it } from 'vitest';
import { DEMO_TENANT_SEEDS } from '../seed/demo-tenants.js';
import { composeDocument, desiredAdapters, splitDraftDocument } from './profile-document.js';

const acme = DEMO_TENANT_SEEDS[0];
if (!acme) {
  throw new Error('missing acme seed');
}

describe('profile document', () => {
  it('stores only the four profile blocks of a valid draft', () => {
    const blocks = splitDraftDocument(acme.profile);
    expect(Object.keys(blocks).sort()).toEqual(['brand', 'compliance', 'market', 'products']);
  });

  it('rejects an invalid draft with VALIDATION_FAILED and issue paths', () => {
    const invalid = { ...acme.profile, market: { ...acme.profile.market, defaultCurrency: 'EUR' } };
    const error = (() => {
      try {
        splitDraftDocument(invalid);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify((error as AppError).details)).toContain('/market/defaultCurrency');
  });

  it('validates the composed document at activation', () => {
    const blocks = splitDraftDocument(acme.profile);
    expect(composeDocument(blocks, { adapters: acme.profile.adapters, deployment: acme.profile.deployment }).deployment.domain).toBe(
      'api.acmepay.example',
    );
    expect(() => composeDocument(blocks, { adapters: acme.profile.adapters })).toThrow(AppError);
    expect(() => composeDocument(blocks, 'nope')).toThrow(AppError);
  });

  it('projects adapters with list order as priority and tenant-scoped secret paths', () => {
    const desired = desiredAdapters(acme.id, acme.profile.adapters);
    const banks = desired.filter((adapter) => adapter.partnerType === 'BANK');
    expect(banks.map((bank) => [bank.provider, bank.priority])).toEqual([
      ['bank-sim-a', 1],
      ['bank-sim-b', 2],
    ]);
    expect(desired.find((adapter) => adapter.partnerType === 'CARD_ISSUER')?.secretRef).toBe(
      `tenants/${acme.id}/adapters/card-issuer/card-sim`,
    );
    expect(desired).toHaveLength(9);
  });
});
