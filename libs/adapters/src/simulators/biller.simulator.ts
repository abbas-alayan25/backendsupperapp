import type {
  BillerAdapter,
  BillerEvent,
  BillerField,
  BillerSummary,
} from '../interfaces/biller.js';
import { SimulatorBase } from './base.js';

const BILLERS: readonly BillerSummary[] = [
  {
    providerBillerCode: 'TEL-1',
    category: 'TELECOM',
    nameEn: 'Sim Telecom',
    nameAr: 'اتصالات تجريبية',
    inquirySupported: true,
  },
  {
    providerBillerCode: 'ELEC-1',
    category: 'ELECTRICITY',
    nameEn: 'Sim Power',
    nameAr: 'كهرباء تجريبية',
    inquirySupported: true,
  },
];

const FIELDS: readonly BillerField[] = [
  {
    fieldKey: 'accountNumber',
    labelEn: 'Account number',
    labelAr: 'رقم الحساب',
    inputType: 'NUMBER',
    regex: '^[0-9]{6,12}$',
    required: true,
  },
];

export class BillerSimulator extends SimulatorBase implements BillerAdapter {
  private readonly payments = new Map<string, Awaited<ReturnType<BillerAdapter['getStatus']>>>();

  listBillers(): Promise<BillerSummary[]> {
    return this.read(() => [...BILLERS]);
  }

  getFields(): Promise<BillerField[]> {
    return this.read(() => [...FIELDS]);
  }

  inquiry(providerBillerCode: string, fields: Readonly<Record<string, string>>) {
    return this.read(() => ({
      inquiryRef: this.newRef('inq'),
      dueAmount: { amountMinor: 2_500n, currency: 'USD' },
      customerName: `Customer ${fields.accountNumber ?? providerBillerCode}`,
    }));
  }

  async pay(request: Parameters<BillerAdapter['pay']>[0]) {
    const result = await this.moneyCall<Awaited<ReturnType<BillerAdapter['pay']>>>(
      request.idempotencyKey,
      {
        success: () => ({
          providerRef: this.newRef('bill'),
          status: 'SUCCESS' as const,
          receipt: { token: 'SIM-RECEIPT' },
        }),
        failure: () => ({
          providerRef: this.newRef('bill'),
          status: 'FAILED' as const,
          failureCode: 'BILLER_REJECTED',
        }),
        pending: () => ({ providerRef: this.newRef('bill'), status: 'PENDING' as const }),
      },
    );
    this.payments.set(result.providerRef, result);
    return result;
  }

  getStatus(providerRef: string) {
    return this.read(() => this.payments.get(providerRef) ?? { status: 'PENDING' as const });
  }

  handleWebhook(payload: Buffer, signature: string): Promise<BillerEvent[]> {
    return this.parseWebhook<BillerEvent>(payload, signature);
  }
}
