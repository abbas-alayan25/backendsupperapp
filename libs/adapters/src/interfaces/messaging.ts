import type { Probeable, WebhookEventBase } from '../types.js';

export type DeliveryEvent = WebhookEventBase & {
  readonly kind: 'DELIVERY_RECEIPT';
  readonly providerMessageId: string;
  readonly status: 'SENT' | 'DELIVERED' | 'FAILED';
};

export interface MessagingAdapter extends Probeable {
  sendOtp(request: {
    readonly to: string;
    readonly code: string;
    readonly locale: 'ar' | 'en';
    readonly channel: 'SMS' | 'WHATSAPP';
    readonly purpose: 'REGISTER' | 'LOGIN' | 'RESET_PIN' | 'NEW_DEVICE' | 'STEP_UP';
  }): Promise<{ readonly providerMessageId: string }>;
  sendSms(request: {
    readonly to: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly providerMessageId: string }>;
  sendPush(request: {
    readonly token: string;
    readonly title: string;
    readonly body: string;
    readonly data?: Readonly<Record<string, string>>;
    readonly collapseKey?: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly providerMessageId: string }>;
  sendEmail(request: {
    readonly to: string;
    readonly subject: string;
    readonly html: string;
    readonly text: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly providerMessageId: string }>;
  handleWebhook(payload: Buffer, signature: string): Promise<DeliveryEvent[]>;
}
