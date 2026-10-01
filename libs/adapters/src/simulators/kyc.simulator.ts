import type { KycCheckResult, KycProviderAdapter, KycProviderEvent } from '../interfaces/kyc.js';
import { SimulatorBase } from './base.js';

const CHECKS = ['OCR', 'AUTHENTICITY', 'LIVENESS', 'FACE_MATCH', 'SANCTIONS', 'PEP'] as const;

export class KycProviderSimulator extends SimulatorBase implements KycProviderAdapter {
  createApplicant(request: Parameters<KycProviderAdapter['createApplicant']>[0]) {
    return this.moneyCall(`applicant:${request.applicationId}`, {
      success: () => ({ providerApplicantId: this.newRef('appl') }),
      failure: () => {
        throw this.unavailable('APPLICANT_REJECTED');
      },
      pending: () => ({ providerApplicantId: this.newRef('appl') }),
    });
  }

  submitDocuments(): Promise<void> {
    return this.read(() => undefined);
  }

  async getResult(): Promise<{
    readonly status: 'PENDING' | 'COMPLETED';
    readonly checks: readonly KycCheckResult[];
  }> {
    if (this.mode === 'timeout') {
      await this.wait();
      throw this.unavailable('TIMEOUT');
    }
    if (this.mode === 'pending') {
      return { status: 'PENDING', checks: [] };
    }
    const result = this.mode === 'failure' ? ('FAIL' as const) : ('PASS' as const);
    return {
      status: 'COMPLETED',
      checks: CHECKS.map((checkType) => ({
        checkType,
        result,
        score: result === 'PASS' ? 98.5 : 12.0,
      })),
    };
  }

  screenSanctions(subject: Parameters<KycProviderAdapter['screenSanctions']>[0]) {
    return this.read(() => ({
      matches:
        this.mode === 'success' && subject.fullName.toUpperCase().includes('SANCTIONED')
          ? [{ source: 'UN', entryRef: 'sim-entry-1', score: 95 }]
          : [],
    }));
  }

  handleWebhook(payload: Buffer, signature: string): Promise<KycProviderEvent[]> {
    return this.parseWebhook<KycProviderEvent>(payload, signature);
  }

  createLivenessSession(providerApplicantId: string) {
    return this.read(() => ({
      sdkToken: `liveness_${providerApplicantId}_${this.newRef('tok')}`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }));
  }
}
