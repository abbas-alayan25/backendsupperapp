import { AppError } from '@super-app/common';
import { expect, it } from 'vitest';
import type { SignedWebhook, SimulatorMode } from '../../simulators/base.js';
import type { Probeable, WebhookEventBase } from '../../types.js';

export interface AdapterContractKit<A extends Probeable> {
  create(mode: SimulatorMode): A | Promise<A>;
  signWebhook(adapter: A, events: readonly object[]): SignedWebhook;
  sampleEvents(): readonly object[];
}

export type WebhookHandler<A> = (
  adapter: A,
  payload: Buffer,
  signature: string,
) => Promise<readonly WebhookEventBase[]>;

export async function expectAppError(
  promise: Promise<unknown>,
  code: string,
  reason?: string,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (reason !== undefined) {
    expect((error as AppError).details.reason).toBe(reason);
  }
}

export function tamper(signature: string): string {
  const last = signature.at(-1) === '0' ? '1' : '0';
  return `${signature.slice(0, -1)}${last}`;
}

export function describeCommonContract<A extends Probeable>(
  kit: AdapterContractKit<A>,
  handle: WebhookHandler<A>,
): void {
  it('reports a healthy probe in success mode and an unhealthy one when the partner fails', async () => {
    const healthy = await (await kit.create('success')).probe();
    expect(healthy.ok).toBe(true);
    expect(healthy.latencyMs).toBeGreaterThanOrEqual(0);
    const failing = await (await kit.create('failure')).probe();
    expect(failing.ok).toBe(false);
  });

  it('parses signed webhooks into neutral events with a partner event id, sequence and timestamp', async () => {
    const adapter = await kit.create('success');
    const signed = kit.signWebhook(adapter, kit.sampleEvents());
    const events = await handle(adapter, signed.payload, signed.signature);
    expect(events.length).toBe(kit.sampleEvents().length);
    for (const event of events) {
      expect(event.partnerEventId).toMatch(/.+/);
      expect(Number.isInteger(event.sequence)).toBe(true);
      expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
    }
  });

  it('rejects webhooks with an invalid signature', async () => {
    const adapter = await kit.create('success');
    const signed = kit.signWebhook(adapter, kit.sampleEvents());
    await expectAppError(
      handle(adapter, signed.payload, tamper(signed.signature)),
      'UNAUTHENTICATED',
      'WEBHOOK_SIGNATURE_INVALID',
    );
    await expectAppError(handle(adapter, signed.payload, ''), 'UNAUTHENTICATED');
  });

  it('rejects a payload altered after signing', async () => {
    const adapter = await kit.create('success');
    const signed = kit.signWebhook(adapter, kit.sampleEvents());
    const altered = Buffer.from(signed.payload.toString('utf8').replace('}', ',"x":1}'));
    await expectAppError(handle(adapter, altered, signed.signature), 'UNAUTHENTICATED');
  });

  it('keeps the partner event id stable when a webhook is delivered twice', async () => {
    const adapter = await kit.create('success');
    const signed = kit.signWebhook(adapter, kit.sampleEvents());
    const first = await handle(adapter, signed.payload, signed.signature);
    const second = await handle(adapter, signed.payload, signed.signature);
    expect(second.map((event) => event.partnerEventId)).toEqual(
      first.map((event) => event.partnerEventId),
    );
  });

  it('exposes sequence numbers so out-of-order deliveries can be reordered', async () => {
    const adapter = await kit.create('success');
    const earlier = kit.signWebhook(adapter, kit.sampleEvents());
    const later = kit.signWebhook(adapter, kit.sampleEvents());
    const laterEvents = await handle(adapter, later.payload, later.signature);
    const earlierEvents = await handle(adapter, earlier.payload, earlier.signature);
    const maxEarlier = Math.max(...earlierEvents.map((event) => event.sequence));
    const minLater = Math.min(...laterEvents.map((event) => event.sequence));
    expect(minLater).toBeGreaterThan(maxEarlier);
  });
}
