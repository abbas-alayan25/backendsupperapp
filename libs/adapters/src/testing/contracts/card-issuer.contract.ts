import { describe, expect, it } from 'vitest';
import type { CardIssuerAdapter, NeutralAuthorization } from '../../interfaces/card-issuer.js';
import { type AdapterContractKit, describeCommonContract, expectAppError, tamper } from './kit.js';

function createRequest(idempotencyKey: string): Parameters<CardIssuerAdapter['createCard']>[0] {
  return {
    cardId: `card-${idempotencyKey}`,
    idempotencyKey,
    programRef: { bin: '400000', form: 'VIRTUAL' },
    cardholderName: 'CONTRACT HOLDER',
    userRef: 'user-1',
    currency: 'USD',
  };
}

export interface CardIssuerContractKit<A extends CardIssuerAdapter> extends AdapterContractKit<A> {
  sampleAuthorization(): NeutralAuthorization & { readonly partnerEventId: string };
}

export function describeCardIssuerAdapterContract<A extends CardIssuerAdapter>(
  name: string,
  kit: CardIssuerContractKit<A>,
): void {
  describe(`CardIssuerAdapter contract: ${name}`, () => {
    describeCommonContract(kit, (adapter, payload, signature) =>
      adapter.handleEvent(payload, signature),
    );

    it('returns the same card for a repeated idempotency key', async () => {
      const adapter = await kit.create('success');
      const first = await adapter.createCard(createRequest('card-1'));
      const second = await adapter.createCard(createRequest('card-1'));
      expect(second).toEqual(first);
      expect(first.last4).toMatch(/^\d{4}$/);
    });

    it('passes the neutral authorization to the decision callback and encodes the answer', async () => {
      const adapter = await kit.create('success');
      const authorization = kit.sampleAuthorization();
      const signed = kit.signWebhook(adapter, [authorization]);
      const seen: NeutralAuthorization[] = [];
      const response = await adapter.handleAuthorization(
        signed.payload,
        signed.signature,
        (neutral) => {
          seen.push(neutral);
          return Promise.resolve({ decision: 'APPROVED', authCode: '123456' });
        },
      );
      expect(response.status).toBe(200);
      expect(seen[0]?.processorAuthId).toBe(authorization.processorAuthId);
      expect(typeof seen[0]?.amount.amountMinor).toBe('bigint');
    });

    it('rejects an authorization with an invalid signature without calling the decision', async () => {
      const adapter = await kit.create('success');
      const signed = kit.signWebhook(adapter, [kit.sampleAuthorization()]);
      let called = false;
      await expectAppError(
        adapter.handleAuthorization(signed.payload, tamper(signed.signature), () => {
          called = true;
          return Promise.resolve({ decision: 'APPROVED' });
        }),
        'UNAUTHENTICATED',
      );
      expect(called).toBe(false);
    });

    it('maps a read timeout to PARTNER_UNAVAILABLE', async () => {
      const adapter = await kit.create('timeout');
      await expectAppError(adapter.getRevealSession('card_x'), 'PARTNER_UNAVAILABLE');
    });
  });
}
