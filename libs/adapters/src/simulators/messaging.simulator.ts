import type { DeliveryEvent, MessagingAdapter } from '../interfaces/messaging.js';
import { SimulatorBase } from './base.js';

export interface SentMessage {
  readonly channel: 'OTP' | 'SMS' | 'PUSH' | 'EMAIL';
  readonly to: string;
  readonly body: string;
  readonly providerMessageId: string;
}

export class MessagingSimulator extends SimulatorBase implements MessagingAdapter {
  readonly sent: SentMessage[] = [];

  sendOtp(request: Parameters<MessagingAdapter['sendOtp']>[0]) {
    return this.deliver(
      'OTP',
      request.to,
      `${request.purpose}:${request.code}`,
      `otp:${request.to}:${request.code}`,
    );
  }

  sendSms(request: Parameters<MessagingAdapter['sendSms']>[0]) {
    return this.deliver('SMS', request.to, request.body, request.idempotencyKey);
  }

  sendPush(request: Parameters<MessagingAdapter['sendPush']>[0]) {
    return this.deliver('PUSH', request.token, request.title, request.idempotencyKey);
  }

  sendEmail(request: Parameters<MessagingAdapter['sendEmail']>[0]) {
    return this.deliver('EMAIL', request.to, request.subject, request.idempotencyKey);
  }

  handleWebhook(payload: Buffer, signature: string): Promise<DeliveryEvent[]> {
    return this.parseWebhook<DeliveryEvent>(payload, signature);
  }

  private async deliver(
    channel: SentMessage['channel'],
    to: string,
    body: string,
    idempotencyKey: string,
  ) {
    if (this.mode === 'failure') {
      throw this.unavailable('DELIVERY_FAILED');
    }
    if (this.mode === 'timeout') {
      await this.wait();
      throw this.unavailable('TIMEOUT');
    }
    return this.moneyCall(idempotencyKey, {
      success: () => this.record(channel, to, body),
      failure: () => this.record(channel, to, body),
      pending: () => this.record(channel, to, body),
    });
  }

  private record(channel: SentMessage['channel'], to: string, body: string) {
    const providerMessageId = this.newRef('msg');
    this.sent.push({ channel, to, body, providerMessageId });
    return { providerMessageId };
  }
}
