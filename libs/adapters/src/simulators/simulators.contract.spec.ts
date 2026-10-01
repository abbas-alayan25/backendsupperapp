import { describe, expect, it } from 'vitest';
import {
  describeAcquirerAdapterContract,
  describeBankAdapterContract,
  describeBillerAdapterContract,
  describeCardIssuerAdapterContract,
  describeKycProviderAdapterContract,
  describeMessagingAdapterContract,
} from '../testing/index.js';
import type { AdapterContext, PartnerType } from '../types.js';
import { AcquirerSimulator } from './acquirer.simulator.js';
import { BankSimulator } from './bank.simulator.js';
import type { SimulatorBase, SimulatorMode } from './base.js';
import { BillerSimulator } from './biller.simulator.js';
import { CardIssuerSimulator } from './card-issuer.simulator.js';
import { KycProviderSimulator } from './kyc.simulator.js';
import { MessagingSimulator } from './messaging.simulator.js';

const TENANT = '0192f5a0-0000-7000-8000-000000000001';

function context(partnerType: PartnerType, provider: string, mode: SimulatorMode): AdapterContext {
  return {
    tenantId: TENANT,
    partnerType,
    provider,
    config: { simulator: { mode, timeoutMs: 5 } },
    secrets: { webhookSecret: 'contract-webhook-secret', apiKey: 'contract-api-key' },
  };
}

const sign = (adapter: SimulatorBase, events: readonly object[]) => adapter.signWebhook(events);

describeBankAdapterContract<BankSimulator>('bank-sim-a', {
  create: (mode) => new BankSimulator(context('BANK', 'bank-sim-a', mode)),
  signWebhook: sign,
  sampleEvents: () => [
    {
      partnerEventId: 'bank-evt-1',
      kind: 'CREDIT_RECEIVED',
      amount: { amountMinor: 10_000n, currency: 'USD' },
      reference: 'VA-123',
      valueDate: '2026-10-01',
      railRef: 'rail-1',
    },
    { partnerEventId: 'bank-evt-2', kind: 'PAYOUT_RESULT', railRef: 'rail-2', status: 'SETTLED' },
  ],
});

describeCardIssuerAdapterContract<CardIssuerSimulator>('card-sim', {
  create: (mode) => new CardIssuerSimulator(context('CARD_ISSUER', 'card-sim', mode)),
  signWebhook: sign,
  sampleEvents: () => [
    {
      partnerEventId: 'card-evt-1',
      kind: 'CARD_STATUS',
      processorCardToken: 'card_1',
      status: 'ACTIVE',
    },
  ],
  sampleAuthorization: () => ({
    partnerEventId: 'auth-evt-1',
    processorAuthId: 'auth-1',
    processorCardToken: 'card_1',
    authType: 'AUTH',
    amount: { amountMinor: 2_500n, currency: 'USD' },
    billingAmount: { amountMinor: 2_500n, currency: 'USD' },
    mcc: '5411',
    merchantName: 'Grocer',
    merchantCountry: 'LB',
    entryMode: 'CHIP',
    isEcommerce: false,
    threeDs: false,
  }),
});

describeKycProviderAdapterContract<KycProviderSimulator>('kyc-sim', {
  create: (mode) => new KycProviderSimulator(context('KYC', 'kyc-sim', mode)),
  signWebhook: sign,
  sampleEvents: () => [
    { partnerEventId: 'kyc-evt-1', kind: 'APPLICANT_REVIEWED', providerApplicantId: 'appl_1' },
  ],
});

describeAcquirerAdapterContract<AcquirerSimulator>('acquirer-sim', {
  create: (mode) => new AcquirerSimulator(context('ACQUIRER', 'acquirer-sim', mode)),
  signWebhook: sign,
  sampleEvents: () => [
    {
      partnerEventId: 'acq-evt-1',
      kind: 'CAPTURED',
      providerPaymentId: 'pay_1',
      amount: { amountMinor: 5_000n, currency: 'USD' },
    },
  ],
});

describeBillerAdapterContract<BillerSimulator>('biller-sim', {
  create: (mode) => new BillerSimulator(context('BILLER', 'biller-sim', mode)),
  signWebhook: sign,
  sampleEvents: () => [
    {
      partnerEventId: 'bill-evt-1',
      kind: 'PAYMENT_STATUS',
      providerRef: 'bill_1',
      status: 'SUCCESS',
    },
  ],
});

for (const partnerType of ['SMS', 'EMAIL', 'PUSH'] as const) {
  describeMessagingAdapterContract<MessagingSimulator>(`${partnerType.toLowerCase()}-sim`, {
    create: (mode) =>
      new MessagingSimulator(context(partnerType, `${partnerType.toLowerCase()}-sim`, mode)),
    signWebhook: sign,
    sampleEvents: () => [
      {
        partnerEventId: 'msg-evt-1',
        kind: 'DELIVERY_RECEIPT',
        providerMessageId: 'msg_1',
        status: 'DELIVERED',
      },
    ],
  });
}

describe('simulator base', () => {
  it('refuses to start without a webhook secret', () => {
    expect(
      () =>
        new BankSimulator({
          tenantId: TENANT,
          partnerType: 'BANK',
          provider: 'bank-sim-a',
          config: {},
          secrets: {},
        }),
    ).toThrow(/webhookSecret/);
  });

  it('restores bigint minor amounts from signed webhooks', async () => {
    const bank = new BankSimulator(context('BANK', 'bank-sim-a', 'success'));
    const signed = bank.signWebhook([
      {
        partnerEventId: 'e1',
        kind: 'RETURNED',
        railRef: 'r1',
        amount: { amountMinor: 9_007_199_254_740_993n, currency: 'USD' },
        reason: 'ACCOUNT_CLOSED',
      },
    ]);
    const [event] = await bank.handleWebhook(signed.payload, signed.signature);
    expect(event?.kind === 'RETURNED' ? event.amount.amountMinor : undefined).toBe(
      9_007_199_254_740_993n,
    );
  });

  it('records sent messages for assertions in other services', async () => {
    const sms = new MessagingSimulator(context('SMS', 'sms-sim', 'success'));
    await sms.sendOtp({
      to: '+96170000001',
      code: '654321',
      locale: 'en',
      channel: 'SMS',
      purpose: 'REGISTER',
    });
    expect(sms.sent).toEqual([
      expect.objectContaining({ channel: 'OTP', to: '+96170000001', body: 'REGISTER:654321' }),
    ]);
  });
});
