import type { AcquirerAdapter, AcquirerEvent } from '../interfaces/acquirer.js';
import type { AdapterMoney } from '../types.js';
import { SimulatorBase } from './base.js';

export class AcquirerSimulator extends SimulatorBase implements AcquirerAdapter {
  createPayment(request: Parameters<AcquirerAdapter['createPayment']>[0]) {
    return this.moneyCall<Awaited<ReturnType<AcquirerAdapter['createPayment']>>>(
      request.idempotencyKey,
      {
        success: () => ({
          providerPaymentId: this.newRef('pay'),
          status: 'REQUIRES_ACTION' as const,
          action: {
            type: 'REDIRECT' as const,
            url: `https://3ds.simulator.test/${request.paymentId}`,
          },
        }),
        failure: () => ({ providerPaymentId: this.newRef('pay'), status: 'DECLINED' as const }),
        pending: () => ({ providerPaymentId: this.newRef('pay'), status: 'PENDING' as const }),
      },
    );
  }

  capture(_providerPaymentId: string, _amount: AdapterMoney, idempotencyKey: string) {
    return this.moneyCall<Awaited<ReturnType<AcquirerAdapter['capture']>>>(idempotencyKey, {
      success: () => ({ status: 'CAPTURED' as const }),
      failure: () => ({ status: 'FAILED' as const }),
      pending: () => ({ status: 'PENDING' as const }),
    });
  }

  refund(_providerPaymentId: string, _amount: AdapterMoney, idempotencyKey: string) {
    return this.moneyCall<Awaited<ReturnType<AcquirerAdapter['refund']>>>(idempotencyKey, {
      success: () => ({ providerRefundId: this.newRef('rfnd'), status: 'REFUNDED' as const }),
      failure: () => ({ providerRefundId: this.newRef('rfnd'), status: 'FAILED' as const }),
      pending: () => ({ providerRefundId: this.newRef('rfnd'), status: 'PENDING' as const }),
    });
  }

  handleWebhook(payload: Buffer, signature: string): Promise<AcquirerEvent[]> {
    return this.parseWebhook<AcquirerEvent>(payload, signature);
  }

  createTokenizationSession(customerRef: string) {
    return this.read(() => ({
      sessionId: this.newRef('tks'),
      clientToken: Buffer.from(`client:${customerRef}`).toString('base64'),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    }));
  }
}
