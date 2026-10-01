import { describe, expect, it } from 'vitest';
import type { AcquirerAdapter } from '../../interfaces/acquirer.js';
import { type AdapterContractKit, describeCommonContract, expectAppError } from './kit.js';

function payment(idempotencyKey: string): Parameters<AcquirerAdapter['createPayment']>[0] {
  return {
    paymentId: `pay-${idempotencyKey}`,
    idempotencyKey,
    amount: { amountMinor: 5_000n, currency: 'USD' },
    fundingCardToken: 'tok_contract',
    customerRef: 'user-1',
    returnUrl: 'https://example.invalid/return',
    threeDs: { deviceChannel: 'APP' },
  };
}

export function describeAcquirerAdapterContract<A extends AcquirerAdapter>(
  name: string,
  kit: AdapterContractKit<A>,
): void {
  describe(`AcquirerAdapter contract: ${name}`, () => {
    describeCommonContract(kit, (adapter, payload, signature) =>
      adapter.handleWebhook(payload, signature),
    );

    it('returns the same payment for a repeated idempotency key', async () => {
      const adapter = await kit.create('success');
      const first = await adapter.createPayment(payment('acq-1'));
      const second = await adapter.createPayment(payment('acq-1'));
      expect(second).toEqual(first);
    });

    it('returns the same refund for a repeated idempotency key', async () => {
      const adapter = await kit.create('success');
      const created = await adapter.createPayment(payment('acq-2'));
      const amount = { amountMinor: 1_000n, currency: 'USD' };
      const first = await adapter.refund(created.providerPaymentId, amount, 'refund-1');
      const second = await adapter.refund(created.providerPaymentId, amount, 'refund-1');
      expect(second).toEqual(first);
    });

    it('reports a pending payment when the partner times out', async () => {
      const adapter = await kit.create('timeout');
      const created = await adapter.createPayment(payment('acq-timeout'));
      expect(created.status).toBe('PENDING');
    });

    it('maps a read timeout to PARTNER_UNAVAILABLE', async () => {
      const adapter = await kit.create('timeout');
      await expectAppError(adapter.createTokenizationSession('user-1'), 'PARTNER_UNAVAILABLE');
    });
  });
}
