import type {
  AccountVerification,
  BankAccountRef,
  BankAdapter,
  BankEvent,
  BankStatement,
  PayoutSubmission,
  PayoutTransfer,
  TransferStatusResult,
  VirtualAccount,
} from '../interfaces/bank.js';
import type { AdapterMoney } from '../types.js';
import { SimulatorBase } from './base.js';

export class BankSimulator extends SimulatorBase implements BankAdapter {
  private readonly transfers = new Map<string, TransferStatusResult>();

  verifyAccount(accountRef: BankAccountRef, holderName: string): Promise<AccountVerification> {
    if (this.mode === 'failure') {
      return Promise.resolve({ status: 'FAILED', nameMatches: false, method: 'NAME_ENQUIRY' });
    }
    return this.read(() => ({
      status: 'VERIFIED' as const,
      holderNameOnFile: holderName.toUpperCase(),
      nameMatches: (accountRef.iban ?? accountRef.accountNumber ?? '').length > 0,
      method: 'NAME_ENQUIRY' as const,
    }));
  }

  async initiatePayout(transfer: PayoutTransfer): Promise<PayoutSubmission> {
    const submission = await this.moneyCall<PayoutSubmission>(transfer.idempotencyKey, {
      success: () => ({ railRef: this.newRef('rail'), status: 'ACCEPTED' }),
      failure: () => ({
        railRef: this.newRef('rail'),
        status: 'REJECTED',
        failureCode: 'ACCOUNT_CLOSED',
      }),
      pending: () => ({ railRef: this.newRef('rail'), status: 'PENDING' }),
    });
    if (!this.transfers.has(submission.railRef)) {
      this.transfers.set(submission.railRef, {
        railRef: submission.railRef,
        status: submission.status,
      });
    }
    return submission;
  }

  getTransferStatus(railRef: string): Promise<TransferStatusResult> {
    return this.read(() => this.transfers.get(railRef) ?? { railRef, status: 'PENDING' as const });
  }

  handleWebhook(payload: Buffer, signature: string): Promise<BankEvent[]> {
    return this.parseWebhook<BankEvent>(payload, signature);
  }

  fetchStatement(date: string): Promise<BankStatement[]> {
    return this.read(() => [
      {
        accountId: `${this.context.provider}-safeguarding`,
        date,
        opening: { amountMinor: 0n, currency: 'USD' },
        closing: { amountMinor: 0n, currency: 'USD' },
        lines: [],
      },
    ]);
  }

  getBalance(accountId: string): Promise<AdapterMoney> {
    return this.read(() => ({
      amountMinor: accountId.length > 0 ? 1_000_000n : 0n,
      currency: 'USD',
    }));
  }

  createVirtualAccount(
    userId: string,
    options: { readonly ownerType: 'USER' | 'MERCHANT' | 'RIDER'; readonly currency: string },
  ): Promise<VirtualAccount> {
    return this.read(() => ({
      iban: `SIM${userId.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      reference: `${options.ownerType}-${userId.slice(0, 8)}`,
      currency: options.currency,
      partnerAccountRef: this.newRef('va'),
    }));
  }
}
