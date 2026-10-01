import type { AdapterMoney, Probeable, WebhookEventBase } from '../types.js';

export interface BillerSummary {
  readonly providerBillerCode: string;
  readonly category:
    'TELECOM' | 'ELECTRICITY' | 'WATER' | 'INTERNET' | 'GOVERNMENT' | 'EDUCATION' | 'OTHER';
  readonly nameEn: string;
  readonly nameAr: string;
  readonly inquirySupported: boolean;
  readonly logoUrl?: string;
}

export interface BillerField {
  readonly fieldKey: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly inputType: 'TEXT' | 'NUMBER' | 'PHONE' | 'SELECT';
  readonly regex?: string;
  readonly required: boolean;
  readonly options?: readonly string[];
}

export type BillPaymentStatus = 'SUCCESS' | 'PENDING' | 'FAILED';

export type BillerEvent = WebhookEventBase & {
  readonly kind: 'PAYMENT_STATUS';
  readonly providerRef: string;
  readonly status: BillPaymentStatus;
  readonly receipt?: Readonly<Record<string, unknown>>;
  readonly failureCode?: string;
};

export interface BillerAdapter extends Probeable {
  listBillers(): Promise<BillerSummary[]>;
  getFields(providerBillerCode: string): Promise<BillerField[]>;
  inquiry(
    providerBillerCode: string,
    fields: Readonly<Record<string, string>>,
  ): Promise<{
    readonly inquiryRef: string;
    readonly dueAmount?: AdapterMoney;
    readonly minAmount?: AdapterMoney;
    readonly maxAmount?: AdapterMoney;
    readonly customerName?: string;
    readonly dueDate?: string;
  }>;
  pay(request: {
    readonly paymentId: string;
    readonly idempotencyKey: string;
    readonly providerBillerCode: string;
    readonly fields: Readonly<Record<string, string>>;
    readonly inquiryRef?: string;
    readonly amount: AdapterMoney;
  }): Promise<{
    readonly providerRef: string;
    readonly status: BillPaymentStatus;
    readonly receipt?: Readonly<Record<string, unknown>>;
    readonly failureCode?: string;
  }>;
  getStatus(providerRef: string): Promise<{
    readonly status: BillPaymentStatus;
    readonly receipt?: Readonly<Record<string, unknown>>;
    readonly failureCode?: string;
  }>;
  handleWebhook(payload: Buffer, signature: string): Promise<BillerEvent[]>;
}
