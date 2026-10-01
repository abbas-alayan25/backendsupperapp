import type { AdapterMoney, Probeable, WebhookEventBase } from '../types.js';

export type AcquirerEvent =
  | (WebhookEventBase & {
      readonly kind: 'THREE_DS_COMPLETED';
      readonly providerPaymentId: string;
      readonly status: 'AUTHORIZED' | 'DECLINED';
    })
  | (WebhookEventBase & {
      readonly kind: 'CAPTURED';
      readonly providerPaymentId: string;
      readonly amount: AdapterMoney;
    })
  | (WebhookEventBase & {
      readonly kind: 'REFUNDED';
      readonly providerPaymentId: string;
      readonly providerRefundId: string;
      readonly amount: AdapterMoney;
    })
  | (WebhookEventBase & {
      readonly kind: 'CHARGEBACK';
      readonly providerPaymentId: string;
      readonly amount: AdapterMoney;
      readonly reasonCode: string;
    });

export interface AcquirerAdapter extends Probeable {
  createPayment(request: {
    readonly paymentId: string;
    readonly idempotencyKey: string;
    readonly amount: AdapterMoney;
    readonly fundingCardToken: string;
    readonly customerRef: string;
    readonly returnUrl: string;
    readonly threeDs: {
      readonly deviceChannel: 'APP' | 'BROWSER';
      readonly browserInfo?: Readonly<Record<string, string>>;
    };
  }): Promise<{
    readonly providerPaymentId: string;
    readonly status: 'AUTHORIZED' | 'REQUIRES_ACTION' | 'DECLINED' | 'PENDING';
    readonly action?: {
      readonly type: 'REDIRECT' | 'SDK';
      readonly url?: string;
      readonly data?: Readonly<Record<string, string>>;
    };
  }>;
  capture(
    providerPaymentId: string,
    amount: AdapterMoney,
    idempotencyKey: string,
  ): Promise<{ readonly status: 'CAPTURED' | 'PENDING' | 'FAILED' }>;
  refund(
    providerPaymentId: string,
    amount: AdapterMoney,
    idempotencyKey: string,
  ): Promise<{
    readonly providerRefundId: string;
    readonly status: 'REFUNDED' | 'PENDING' | 'FAILED';
  }>;
  handleWebhook(payload: Buffer, signature: string): Promise<AcquirerEvent[]>;
  createTokenizationSession(customerRef: string): Promise<{
    readonly sessionId: string;
    readonly clientToken: string;
    readonly expiresAt: string;
  }>;
}
