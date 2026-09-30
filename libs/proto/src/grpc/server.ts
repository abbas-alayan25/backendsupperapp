import type { Metadata, ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import {
  AppError,
  DEFAULT_LOCALE,
  type RequestContext,
  isUuid,
  newId,
  runWithContext,
} from '@super-app/common';
import { toGrpcError } from './errors.js';
import { IDEMPOTENCY_KEY_METADATA, REQUEST_ID_METADATA, TENANT_ID_METADATA } from './metadata.js';

function first(metadata: Metadata, key: string): string | undefined {
  const value = metadata.get(key)[0];
  return value === undefined ? undefined : value.toString();
}

export function contextFromMetadata(metadata: Metadata): RequestContext {
  const tenantId = first(metadata, TENANT_ID_METADATA);
  if (!tenantId || !isUuid(tenantId)) {
    throw new AppError('FORBIDDEN', { reason: 'TENANT_UNRESOLVED' });
  }
  return {
    tenantId: tenantId.toLowerCase(),
    requestId: first(metadata, REQUEST_ID_METADATA) ?? newId(),
    locale: DEFAULT_LOCALE,
  };
}

export function idempotencyKeyFrom(metadata: Metadata): string | undefined {
  return first(metadata, IDEMPOTENCY_KEY_METADATA);
}

export type UnaryHandler<Req, Res> = (
  request: Req,
  call: ServerUnaryCall<Req, Res>,
) => Promise<Res>;

export function unary<Req, Res>(handler: UnaryHandler<Req, Res>) {
  return (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>): void => {
    let context: RequestContext;
    try {
      context = contextFromMetadata(call.metadata);
    } catch (error) {
      callback(toGrpcError(error));
      return;
    }
    runWithContext(context, () => handler(call.request, call)).then(
      (response) => {
        callback(null, response);
      },
      (error: unknown) => {
        callback(toGrpcError(error));
      },
    );
  };
}
