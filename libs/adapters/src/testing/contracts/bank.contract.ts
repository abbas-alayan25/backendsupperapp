import { describe, expect, it } from 'vitest';
import type { BankAdapter, PayoutTransfer } from '../../interfaces/bank.js';
import { type AdapterContractKit, describeCommonContract, expectAppError } from './kit.js';

function transfer(idempotencyKey: string): PayoutTransfer {
  return {
    transferId: `tr-${idempotencyKey}`,
    idempotencyKey,
    fromAccountId: 'safeguarding-1',
    to: { iban: 'LB62099900000001001901229114', currency: 'USD' },
    beneficiaryName: 'Contract Beneficiary',
    amount: { amountMinor: 12_345n, currency: 'USD' },
    reference: 'contract',
    rail: 'INSTANT',
  };
}

export function describeBankAdapterContract<A extends BankAdapter>(
  name: string,
  kit: AdapterContractKit<A>,
): void {
  describe(`BankAdapter contract: ${name}`, () => {
    describeCommonContract(kit, (adapter, payload, signature) =>
      adapter.handleWebhook(payload, signature),
    );

    it('returns the same submission for a repeated idempotency key', async () => {
      const adapter = await kit.create('success');
      const first = await adapter.initiatePayout(transfer('payout-1'));
      const second = await adapter.initiatePayout(transfer('payout-1'));
      expect(second).toEqual(first);
      const other = await adapter.initiatePayout(transfer('payout-2'));
      expect(other.railRef).not.toBe(first.railRef);
    });

    it('reports a pending payout when the partner times out instead of failing', async () => {
      const adapter = await kit.create('timeout');
      const submission = await adapter.initiatePayout(transfer('payout-timeout'));
      expect(submission.status).toBe('PENDING');
      const status = await (await kit.create('success')).getTransferStatus(submission.railRef);
      expect(status.railRef).toBe(submission.railRef);
    });

    it('maps a read timeout to PARTNER_UNAVAILABLE', async () => {
      const adapter = await kit.create('timeout');
      await expectAppError(adapter.getBalance('safeguarding-1'), 'PARTNER_UNAVAILABLE');
      await expectAppError(adapter.fetchStatement('2026-01-01'), 'PARTNER_UNAVAILABLE');
    });

    it('returns money in minor units as bigint', async () => {
      const adapter = await kit.create('success');
      const balance = await adapter.getBalance('safeguarding-1');
      expect(typeof balance.amountMinor).toBe('bigint');
      expect(balance.currency).toMatch(/^[A-Z]{3}$/);
    });

    it('creates virtual accounts in the requested currency', async () => {
      const adapter = await kit.create('success');
      const account = await adapter.createVirtualAccount('0192f5a0-0000-7000-8000-00000000abcd', {
        ownerType: 'USER',
        currency: 'USD',
      });
      expect(account.currency).toBe('USD');
      expect(account.partnerAccountRef).toMatch(/.+/);
    });
  });
}
