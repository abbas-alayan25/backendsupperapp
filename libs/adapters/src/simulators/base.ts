import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '@super-app/common';
import type { AdapterContext, ProbeResult, WebhookEventBase } from '../types.js';

export const SIMULATOR_MODES = ['success', 'failure', 'timeout', 'pending'] as const;

export type SimulatorMode = (typeof SIMULATOR_MODES)[number];

export interface SignedWebhook {
  readonly payload: Buffer;
  readonly signature: string;
}

export const SIMULATOR_CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    simulator: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { enum: [...SIMULATOR_MODES] },
        timeoutMs: { type: 'integer', minimum: 0, maximum: 60_000 },
      },
    },
  },
} as const;

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

function deserialize(text: string): unknown {
  return JSON.parse(text, (key, item: unknown) =>
    (key.endsWith('Minor') || key === 'amountMinor') && typeof item === 'string'
      ? BigInt(item)
      : item,
  );
}

export abstract class SimulatorBase {
  protected readonly mode: SimulatorMode;
  protected readonly timeoutMs: number;
  private readonly webhookSecret: string;
  private readonly idempotent = new Map<string, unknown>();
  private sequence = 0;

  constructor(protected readonly context: AdapterContext) {
    const simulator = (context.config.simulator ?? {}) as {
      mode?: SimulatorMode;
      timeoutMs?: number;
    };
    this.mode = simulator.mode ?? 'success';
    this.timeoutMs = simulator.timeoutMs ?? 50;
    const secret = context.secrets.webhookSecret;
    if (!secret) {
      throw new Error(`Simulator ${context.provider} has no webhookSecret`);
    }
    this.webhookSecret = secret;
  }

  async probe(): Promise<ProbeResult> {
    const started = Date.now();
    if (this.mode === 'timeout') {
      await this.wait();
      return { ok: false, latencyMs: Date.now() - started, detail: 'timeout' };
    }
    return {
      ok: this.mode !== 'failure',
      latencyMs: Date.now() - started,
      ...(this.mode === 'failure' ? { detail: 'partner rejected the connection' } : {}),
    };
  }

  signWebhook(
    events: readonly Omit<WebhookEventBase, 'sequence' | 'occurredAt'>[] | readonly object[],
  ): SignedWebhook {
    const stamped = events.map((event) => ({
      sequence: (this.sequence += 1),
      occurredAt: new Date().toISOString(),
      ...event,
    }));
    const payload = Buffer.from(serialize({ events: stamped }));
    return { payload, signature: this.sign(payload) };
  }

  protected newRef(prefix: string): string {
    return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  }

  protected wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.timeoutMs));
  }

  protected async read<T>(produce: () => T): Promise<T> {
    if (this.mode === 'timeout') {
      await this.wait();
      throw this.unavailable('TIMEOUT');
    }
    if (this.mode === 'failure') {
      throw this.unavailable('PARTNER_ERROR');
    }
    return produce();
  }

  protected async moneyCall<T>(
    idempotencyKey: string,
    outcomes: { success: () => T; failure: () => T; pending: () => T },
  ): Promise<T> {
    const cached = this.idempotent.get(idempotencyKey) as T | undefined;
    if (cached !== undefined) {
      return cached;
    }
    if (this.mode === 'timeout') {
      await this.wait();
    }
    const result =
      this.mode === 'success'
        ? outcomes.success()
        : this.mode === 'failure'
          ? outcomes.failure()
          : outcomes.pending();
    this.idempotent.set(idempotencyKey, result);
    return result;
  }

  protected verifyWebhook<T>(payload: Buffer, signature: string): T[] {
    const expected = Buffer.from(this.sign(payload), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AppError('UNAUTHENTICATED', {
        reason: 'WEBHOOK_SIGNATURE_INVALID',
        provider: this.context.provider,
      });
    }
    const parsed = deserialize(payload.toString('utf8')) as { events?: T[] };
    if (!Array.isArray(parsed.events)) {
      throw new AppError('VALIDATION_FAILED', { reason: 'WEBHOOK_PAYLOAD_INVALID' });
    }
    return parsed.events;
  }

  protected parseWebhook<T>(payload: Buffer, signature: string): Promise<T[]> {
    return Promise.resolve().then(() => this.verifyWebhook<T>(payload, signature));
  }

  protected unavailable(reason: string): AppError {
    return new AppError('PARTNER_UNAVAILABLE', { reason, provider: this.context.provider });
  }

  private sign(payload: Buffer): string {
    return createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
  }
}
