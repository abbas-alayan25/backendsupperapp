import { describe, expect, it } from 'vitest';
import type { BillerAdapter } from '../../interfaces/biller.js';
import { type AdapterContractKit, describeCommonContract, expectAppError } from './kit.js';

export function describeBillerAdapterContract<A extends BillerAdapter>(
  name: string,
  kit: AdapterContractKit<A>,
): void {
  describe(`BillerAdapter contract: ${name}`, () => {
    describeCommonContract(kit, (adapter, payload, signature) =>
      adapter.handleWebhook(payload, signature),
    );

    it('lists billers with their fields', async () => {
      const adapter = await kit.create('success');
      const billers = await adapter.listBillers();
      expect(billers.length).toBeGreaterThan(0);
      const [first] = billers;
      if (first) {
        const fields = await adapter.getFields(first.providerBillerCode);
        expect(Array.isArray(fields)).toBe(true);
      }
    });

    it('returns the same payment for a repeated idempotency key', async () => {
      const adapter = await kit.create('success');
      const [biller] = await adapter.listBillers();
      const request = {
        paymentId: 'bill-1',
        idempotencyKey: 'bill-1',
        providerBillerCode: biller?.providerBillerCode ?? 'unknown',
        fields: { account: '12345' },
        amount: { amountMinor: 2_500n, currency: 'USD' },
      };
      const first = await adapter.pay(request);
      const second = await adapter.pay(request);
      expect(second).toEqual(first);
    });

    it('reports a pending payment when the partner times out', async () => {
      const adapter = await kit.create('timeout');
      const result = await adapter.pay({
        paymentId: 'bill-timeout',
        idempotencyKey: 'bill-timeout',
        providerBillerCode: 'any',
        fields: {},
        amount: { amountMinor: 100n, currency: 'USD' },
      });
      expect(result.status).toBe('PENDING');
    });

    it('maps a read timeout to PARTNER_UNAVAILABLE', async () => {
      const adapter = await kit.create('timeout');
      await expectAppError(adapter.listBillers(), 'PARTNER_UNAVAILABLE');
    });
  });
}
