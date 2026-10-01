import type { AdapterMoney, Probeable, WebhookEventBase } from '../types.js';

export interface CardAddress {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly country: string;
  readonly postalCode?: string;
}

export interface CardControls {
  readonly ecommerce: boolean;
  readonly atm: boolean;
  readonly contactless: boolean;
  readonly international: boolean;
  readonly mccBlocklist: readonly string[];
  readonly countryAllowlist: readonly string[];
  readonly perTxnLimitMinor?: bigint;
  readonly dailyLimitMinor?: bigint;
  readonly monthlyLimitMinor?: bigint;
}

export type AuthType =
  'AUTH' | 'INCREMENTAL' | 'REVERSAL' | 'PARTIAL_REVERSAL' | 'ADVICE' | 'FORCE_POST';

export interface NeutralAuthorization {
  readonly processorAuthId: string;
  readonly processorCardToken: string;
  readonly authType: AuthType;
  readonly amount: AdapterMoney;
  readonly billingAmount: AdapterMoney;
  readonly mcc: string;
  readonly merchantName: string;
  readonly merchantCity?: string;
  readonly merchantCountry: string;
  readonly entryMode: string;
  readonly isEcommerce: boolean;
  readonly threeDs: boolean;
  readonly stan?: string;
  readonly rrn?: string;
  readonly originalProcessorAuthId?: string;
}

export interface AuthorizationDecision {
  readonly decision: 'APPROVED' | 'DECLINED';
  readonly authCode?: string;
  readonly declineCode?: string;
}

export interface EncodedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

export interface NeutralClearingRecord {
  readonly clearingRef: string;
  readonly processorAuthId?: string;
  readonly processorCardToken: string;
  readonly amount: AdapterMoney;
  readonly billingAmount: AdapterMoney;
  readonly fxRate?: string;
  readonly fee?: AdapterMoney;
  readonly kind: 'CLEARING' | 'REVERSAL' | 'REFUND' | 'FORCE_POST';
}

export type CardEvent =
  | (WebhookEventBase & {
      readonly kind: 'CARD_STATUS';
      readonly processorCardToken: string;
      readonly status: string;
    })
  | (WebhookEventBase & {
      readonly kind: 'TOKEN_STATUS';
      readonly tokenRef: string;
      readonly status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    })
  | (WebhookEventBase & {
      readonly kind: 'DISPUTE_UPDATE';
      readonly processorDisputeId: string;
      readonly status: string;
    })
  | (WebhookEventBase & {
      readonly kind: 'SETTLEMENT';
      readonly settlementDate: string;
      readonly network: 'VISA' | 'MASTERCARD';
      readonly gross: AdapterMoney;
      readonly interchange: AdapterMoney;
      readonly schemeFees: AdapterMoney;
      readonly net: AdapterMoney;
    });

export interface CardIssuerAdapter extends Probeable {
  createCard(request: {
    readonly cardId: string;
    readonly idempotencyKey: string;
    readonly programRef: { readonly bin: string; readonly form: 'VIRTUAL' | 'PHYSICAL' };
    readonly cardholderName: string;
    readonly userRef: string;
    readonly currency: string;
    readonly shippingAddress?: CardAddress;
  }): Promise<{
    readonly processorCardToken: string;
    readonly last4: string;
    readonly expiryMonth: number;
    readonly expiryYear: number;
    readonly status: 'ISSUED' | 'REQUESTED';
  }>;
  updateStatus(
    processorCardToken: string,
    status: 'ACTIVE' | 'FROZEN' | 'BLOCKED' | 'CLOSED',
    reason?: 'LOST' | 'STOLEN' | 'FRAUD' | 'DAMAGED' | 'ADMIN',
  ): Promise<void>;
  setControls(processorCardToken: string, controls: CardControls): Promise<void>;
  getRevealSession(processorCardToken: string): Promise<{
    readonly sessionToken: string;
    readonly expiresAt: string;
    readonly sdkConfig: Readonly<Record<string, string>>;
  }>;
  getPinSession(processorCardToken: string): Promise<{
    readonly sessionToken: string;
    readonly expiresAt: string;
    readonly sdkConfig: Readonly<Record<string, string>>;
  }>;
  handleAuthorization(
    payload: Buffer,
    signature: string,
    decide: (authorization: NeutralAuthorization) => Promise<AuthorizationDecision>,
  ): Promise<EncodedResponse>;
  handleClearing(input: {
    readonly source: 'WEBHOOK' | 'FILE';
    readonly content: Buffer;
    readonly signature?: string;
  }): Promise<NeutralClearingRecord[]>;
  handleEvent(payload: Buffer, signature: string): Promise<CardEvent[]>;
  submitDispute(dispute: {
    readonly disputeId: string;
    readonly idempotencyKey: string;
    readonly processorTransactionRef: string;
    readonly reasonCode: string;
    readonly amount: AdapterMoney;
    readonly evidence: readonly {
      readonly name: string;
      readonly contentType: string;
      readonly url: string;
    }[];
  }): Promise<{ readonly processorDisputeId: string; readonly status: 'SUBMITTED' }>;
  provisionToken(
    processorCardToken: string,
    request: {
      readonly walletProvider: 'APPLE_PAY' | 'GOOGLE_PAY' | 'SAMSUNG_PAY';
      readonly deviceName: string;
      readonly certificates?: readonly string[];
      readonly nonce?: string;
      readonly nonceSignature?: string;
    },
  ): Promise<{
    readonly activationData: string;
    readonly encryptedPassData: string;
    readonly ephemeralPublicKey: string;
  }>;
}
