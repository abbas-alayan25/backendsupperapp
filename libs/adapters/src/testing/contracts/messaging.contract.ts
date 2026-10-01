import { describe, expect, it } from 'vitest';
import type { MessagingAdapter } from '../../interfaces/messaging.js';
import { type AdapterContractKit, describeCommonContract, expectAppError } from './kit.js';

export function describeMessagingAdapterContract<A extends MessagingAdapter>(
  name: string,
  kit: AdapterContractKit<A>,
): void {
  describe(`MessagingAdapter contract: ${name}`, () => {
    describeCommonContract(kit, (adapter, payload, signature) =>
      adapter.handleWebhook(payload, signature),
    );

    it('returns the same message id for a repeated idempotency key', async () => {
      const adapter = await kit.create('success');
      const request = { to: '+96170000000', body: 'hello', idempotencyKey: 'sms-1' };
      const first = await adapter.sendSms(request);
      const second = await adapter.sendSms(request);
      expect(second.providerMessageId).toBe(first.providerMessageId);
    });

    it('sends OTPs, pushes and emails', async () => {
      const adapter = await kit.create('success');
      const otp = await adapter.sendOtp({
        to: '+96170000000',
        code: '123456',
        locale: 'ar',
        channel: 'SMS',
        purpose: 'LOGIN',
      });
      const push = await adapter.sendPush({
        token: 'device',
        title: 't',
        body: 'b',
        idempotencyKey: 'push-1',
      });
      const email = await adapter.sendEmail({
        to: 'a@example.invalid',
        subject: 's',
        html: '<p>h</p>',
        text: 'h',
        idempotencyKey: 'mail-1',
      });
      for (const sent of [otp, push, email]) {
        expect(sent.providerMessageId).toMatch(/.+/);
      }
    });

    it('maps a send failure to PARTNER_UNAVAILABLE', async () => {
      const adapter = await kit.create('failure');
      await expectAppError(
        adapter.sendOtp({
          to: '+96170000000',
          code: '123456',
          locale: 'en',
          channel: 'SMS',
          purpose: 'LOGIN',
        }),
        'PARTNER_UNAVAILABLE',
      );
    });
  });
}
