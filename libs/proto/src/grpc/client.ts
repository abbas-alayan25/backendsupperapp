import {
  type ChannelCredentials,
  type Client,
  type ClientOptions,
  type Interceptor,
  InterceptingCall,
  Metadata,
  credentials,
} from '@grpc/grpc-js';
import { context as otelContext, propagation } from '@opentelemetry/api';
import { MissingRequestContextError, currentContext } from '@super-app/common';
import {
  IDEMPOTENCY_KEY_METADATA,
  REQUEST_ID_METADATA,
  TENANT_ID_METADATA,
  TRACEPARENT_METADATA,
  deadlineFor,
} from './metadata.js';

export function contextInterceptor(serviceName: string): Interceptor {
  const deadlineMs = deadlineFor(serviceName);
  return (options, nextCall) => {
    const context = currentContext();
    if (!context) {
      throw new MissingRequestContextError();
    }
    options.deadline ??= Date.now() + deadlineMs;
    return new InterceptingCall(nextCall(options), {
      start(metadata, listener, next) {
        metadata.set(TENANT_ID_METADATA, context.tenantId);
        metadata.set(REQUEST_ID_METADATA, context.requestId);
        const carrier: Record<string, string> = {};
        propagation.inject(otelContext.active(), carrier);
        const traceparent = carrier[TRACEPARENT_METADATA];
        if (traceparent) {
          metadata.set(TRACEPARENT_METADATA, traceparent);
        }
        next(metadata, listener);
      },
    });
  };
}

export function idempotencyMetadata(key: string): Metadata {
  const metadata = new Metadata();
  metadata.set(IDEMPOTENCY_KEY_METADATA, key);
  return metadata;
}

export type GrpcClientConstructor<C extends Client> = new (
  address: string,
  channelCredentials: ChannelCredentials,
  options?: Partial<ClientOptions>,
) => C & Client;

export function createGrpcClient<C extends Client>(
  constructor: GrpcClientConstructor<C> & { serviceName: string },
  address: string,
  channelCredentials: ChannelCredentials = credentials.createInsecure(),
): C {
  return new constructor(address, channelCredentials, {
    interceptors: [contextInterceptor(constructor.serviceName)],
  });
}
