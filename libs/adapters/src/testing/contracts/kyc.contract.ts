import { describe, expect, it } from 'vitest';
import type { KycProviderAdapter } from '../../interfaces/kyc.js';
import { type AdapterContractKit, describeCommonContract, expectAppError } from './kit.js';

export function describeKycProviderAdapterContract<A extends KycProviderAdapter>(
  name: string,
  kit: AdapterContractKit<A>,
): void {
  describe(`KycProviderAdapter contract: ${name}`, () => {
    describeCommonContract(kit, (adapter, payload, signature) =>
      adapter.handleWebhook(payload, signature),
    );

    it('creates an applicant and returns results for it', async () => {
      const adapter = await kit.create('success');
      const applicant = await adapter.createApplicant({
        applicationId: 'app-1',
        userRef: 'user-1',
        targetTier: 1,
        person: { fullName: 'Contract Person' },
      });
      expect(applicant.providerApplicantId).toMatch(/.+/);
      const result = await adapter.getResult(applicant.providerApplicantId);
      expect(['PENDING', 'COMPLETED']).toContain(result.status);
      const liveness = await adapter.createLivenessSession(applicant.providerApplicantId);
      expect(Number.isNaN(Date.parse(liveness.expiresAt))).toBe(false);
    });

    it('returns sanction match scores between 0 and 100', async () => {
      const adapter = await kit.create('success');
      const screening = await adapter.screenSanctions({
        entityType: 'PERSON',
        fullName: 'Contract Person',
      });
      for (const match of screening.matches) {
        expect(match.score).toBeGreaterThanOrEqual(0);
        expect(match.score).toBeLessThanOrEqual(100);
      }
    });

    it('maps a read timeout to PARTNER_UNAVAILABLE', async () => {
      const adapter = await kit.create('timeout');
      await expectAppError(adapter.getResult('applicant-x'), 'PARTNER_UNAVAILABLE');
    });
  });
}
