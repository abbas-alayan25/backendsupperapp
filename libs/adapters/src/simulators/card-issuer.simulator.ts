import type {
  AuthorizationDecision,
  CardEvent,
  CardIssuerAdapter,
  EncodedResponse,
  NeutralAuthorization,
  NeutralClearingRecord,
} from '../interfaces/card-issuer.js';
import { SimulatorBase } from './base.js';

export class CardIssuerSimulator extends SimulatorBase implements CardIssuerAdapter {
  private readonly cards = new Map<string, string>();

  async createCard(
    request: Parameters<CardIssuerAdapter['createCard']>[0],
  ): ReturnType<CardIssuerAdapter['createCard']> {
    return this.moneyCall(request.idempotencyKey, {
      success: () => {
        const token = this.newRef('card');
        this.cards.set(token, 'ISSUED');
        return {
          processorCardToken: token,
          last4: String(1000 + (token.charCodeAt(token.length - 1) % 9000)).slice(-4),
          expiryMonth: 12,
          expiryYear: new Date().getUTCFullYear() + 4,
          status:
            request.programRef.form === 'VIRTUAL' ? ('ISSUED' as const) : ('REQUESTED' as const),
        };
      },
      failure: () => {
        throw this.unavailable('CARD_CREATION_REJECTED');
      },
      pending: () => ({
        processorCardToken: this.newRef('card'),
        last4: '0000',
        expiryMonth: 12,
        expiryYear: new Date().getUTCFullYear() + 4,
        status: 'REQUESTED' as const,
      }),
    });
  }

  updateStatus(
    processorCardToken: string,
    status: 'ACTIVE' | 'FROZEN' | 'BLOCKED' | 'CLOSED',
  ): Promise<void> {
    return this.read(() => {
      this.cards.set(processorCardToken, status);
    });
  }

  setControls(): Promise<void> {
    return this.read(() => undefined);
  }

  getRevealSession(processorCardToken: string) {
    return this.read(() => this.session(processorCardToken, 'reveal'));
  }

  getPinSession(processorCardToken: string) {
    return this.read(() => this.session(processorCardToken, 'pin'));
  }

  async handleAuthorization(
    payload: Buffer,
    signature: string,
    decide: (authorization: NeutralAuthorization) => Promise<AuthorizationDecision>,
  ): Promise<EncodedResponse> {
    const [authorization] = this.verifyWebhook<NeutralAuthorization & { partnerEventId: string }>(
      payload,
      signature,
    );
    if (!authorization) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"error":"empty"}'),
      };
    }
    const decision = await decide(authorization);
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          processorAuthId: authorization.processorAuthId,
          approved: decision.decision === 'APPROVED',
          authCode: decision.authCode ?? null,
          declineCode: decision.declineCode ?? null,
        }),
      ),
    };
  }

  handleClearing(input: {
    readonly source: 'WEBHOOK' | 'FILE';
    readonly content: Buffer;
    readonly signature?: string;
  }) {
    return this.parseWebhook<NeutralClearingRecord>(input.content, input.signature ?? '');
  }

  handleEvent(payload: Buffer, signature: string): Promise<CardEvent[]> {
    return this.parseWebhook<CardEvent>(payload, signature);
  }

  submitDispute(dispute: Parameters<CardIssuerAdapter['submitDispute']>[0]) {
    return this.moneyCall(dispute.idempotencyKey, {
      success: () => ({ processorDisputeId: this.newRef('dsp'), status: 'SUBMITTED' as const }),
      failure: () => {
        throw this.unavailable('DISPUTE_REJECTED');
      },
      pending: () => ({ processorDisputeId: this.newRef('dsp'), status: 'SUBMITTED' as const }),
    });
  }

  provisionToken(processorCardToken: string) {
    return this.read(() => ({
      activationData: Buffer.from(`activate:${processorCardToken}`).toString('base64'),
      encryptedPassData: Buffer.from(`pass:${processorCardToken}`).toString('base64'),
      ephemeralPublicKey: Buffer.from(`key:${processorCardToken}`).toString('base64'),
    }));
  }

  private session(processorCardToken: string, purpose: string) {
    return {
      sessionToken: `${purpose}_${this.newRef('sess')}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      sdkConfig: { environment: 'simulator', card: processorCardToken },
    };
  }
}
