import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { currentContext, hashUserId } from '@super-app/common';

export class TenantSpanProcessor implements SpanProcessor {
  constructor(private readonly userIdHashKey: string | Uint8Array) {}

  onStart(span: Span, _parentContext: Context): void {
    const context = currentContext();
    if (!context) {
      return;
    }
    span.setAttribute('tenant_id', context.tenantId);
    span.setAttribute('request_id', context.requestId);
    if (context.userId) {
      span.setAttribute('user_id', hashUserId(context.userId, this.userIdHashKey));
    }
  }

  onEnd(_span: ReadableSpan): void {
    return;
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
