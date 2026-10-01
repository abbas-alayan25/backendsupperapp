import type { AdapterMoney, Probeable, WebhookEventBase } from '../types.js';

export interface BankAccountRef {
  readonly iban?: string;
  readonly accountNumber?: string;
  readonly bankCode?: string;
  readonly currency: string;
}

export interface AccountVerification {
  readonly status: 'VERIFIED' | 'FAILED' | 'PENDING';
  readonly holderNameOnFile?: string;
  readonly nameMatches: boolean;
  readonly method: 'NAME_ENQUIRY' | 'PENNY_TEST' | 'DOCUMENT';
}

export type BankRail = 'INSTANT' | 'ACH' | 'SWIFT' | 'BOOK';

export interface PayoutTransfer {
  readonly transferId: string;
  readonly idempotencyKey: string;
  readonly fromAccountId: string;
  readonly to: BankAccountRef;
  readonly beneficiaryName: string;
  readonly amount: AdapterMoney;
  readonly reference: string;
  readonly rail: BankRail;
}

export type TransferStatus =
  'SUBMITTED' | 'ACCEPTED' | 'SETTLED' | 'REJECTED' | 'RETURNED' | 'PENDING';

export interface PayoutSubmission {
  readonly railRef: string;
  readonly status: Exclude<TransferStatus, 'RETURNED'>;
  readonly failureCode?: string;
}

export interface TransferStatusResult {
  readonly railRef: string;
  readonly status: TransferStatus;
  readonly valueDate?: string;
  readonly failureCode?: string;
}

export type BankEvent =
  | (WebhookEventBase & {
      readonly kind: 'CREDIT_RECEIVED';
      readonly amount: AdapterMoney;
      readonly reference: string;
      readonly virtualAccountRef?: string;
      readonly counterpartyName?: string;
      readonly counterpartyIban?: string;
      readonly valueDate: string;
      readonly railRef: string;
    })
  | (WebhookEventBase & {
      readonly kind: 'PAYOUT_RESULT';
      readonly railRef: string;
      readonly status: TransferStatus;
      readonly failureCode?: string;
    })
  | (WebhookEventBase & {
      readonly kind: 'RETURNED';
      readonly railRef: string;
      readonly amount: AdapterMoney;
      readonly reason: string;
    });

export interface StatementLine {
  readonly valueDate: string;
  readonly amount: AdapterMoney;
  readonly direction: 'CREDIT' | 'DEBIT';
  readonly reference: string;
  readonly counterpartyName?: string;
  readonly counterpartyIban?: string;
}

export interface BankStatement {
  readonly accountId: string;
  readonly date: string;
  readonly opening: AdapterMoney;
  readonly closing: AdapterMoney;
  readonly lines: readonly StatementLine[];
}

export interface VirtualAccount {
  readonly iban: string;
  readonly reference: string;
  readonly currency: string;
  readonly partnerAccountRef: string;
}

export interface BankAdapter extends Probeable {
  verifyAccount(accountRef: BankAccountRef, holderName: string): Promise<AccountVerification>;
  initiatePayout(transfer: PayoutTransfer): Promise<PayoutSubmission>;
  getTransferStatus(railRef: string): Promise<TransferStatusResult>;
  handleWebhook(payload: Buffer, signature: string): Promise<BankEvent[]>;
  fetchStatement(date: string): Promise<BankStatement[]>;
  getBalance(accountId: string): Promise<AdapterMoney>;
  createVirtualAccount(
    userId: string,
    options: { readonly ownerType: 'USER' | 'MERCHANT' | 'RIDER'; readonly currency: string },
  ): Promise<VirtualAccount>;
}
