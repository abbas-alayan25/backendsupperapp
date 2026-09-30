import { Metadata, type ServiceError, status } from '@grpc/grpc-js';
import { AppError, type ErrorCode, isAppError, isErrorCode } from '@super-app/common';
import { ERROR_CODE_METADATA, ERROR_DETAILS_METADATA } from './metadata.js';

export const GRPC_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, status>> = {
  VALIDATION_FAILED: status.INVALID_ARGUMENT,
  UNAUTHENTICATED: status.UNAUTHENTICATED,
  FORBIDDEN: status.PERMISSION_DENIED,
  NOT_FOUND: status.NOT_FOUND,
  CONFLICT: status.ABORTED,
  DUPLICATE_REQUEST: status.ALREADY_EXISTS,
  INSUFFICIENT_FUNDS: status.FAILED_PRECONDITION,
  LIMIT_EXCEEDED: status.FAILED_PRECONDITION,
  KYC_REQUIRED: status.FAILED_PRECONDITION,
  STEP_UP_REQUIRED: status.FAILED_PRECONDITION,
  RISK_DECLINED: status.FAILED_PRECONDITION,
  RISK_REVIEW: status.FAILED_PRECONDITION,
  ACCOUNT_FROZEN: status.FAILED_PRECONDITION,
  SERVICE_DISABLED: status.FAILED_PRECONDITION,
  UPDATE_REQUIRED: status.FAILED_PRECONDITION,
  MAINTENANCE: status.UNAVAILABLE,
  RATE_LIMITED: status.RESOURCE_EXHAUSTED,
  PARTNER_UNAVAILABLE: status.UNAVAILABLE,
  INTERNAL_ERROR: status.INTERNAL,
};

const ERROR_CODE_BY_GRPC_STATUS: Readonly<Partial<Record<status, ErrorCode>>> = {
  [status.INVALID_ARGUMENT]: 'VALIDATION_FAILED',
  [status.UNAUTHENTICATED]: 'UNAUTHENTICATED',
  [status.PERMISSION_DENIED]: 'FORBIDDEN',
  [status.NOT_FOUND]: 'NOT_FOUND',
  [status.ABORTED]: 'CONFLICT',
  [status.ALREADY_EXISTS]: 'DUPLICATE_REQUEST',
  [status.RESOURCE_EXHAUSTED]: 'RATE_LIMITED',
  [status.UNAVAILABLE]: 'PARTNER_UNAVAILABLE',
  [status.DEADLINE_EXCEEDED]: 'PARTNER_UNAVAILABLE',
};

export interface GrpcErrorLike {
  code: status;
  details: string;
  metadata: Metadata;
}

export function toGrpcError(error: unknown): GrpcErrorLike {
  const appError = isAppError(error) ? error : new AppError('INTERNAL_ERROR', {}, { cause: error });
  const metadata = new Metadata();
  metadata.set(ERROR_CODE_METADATA, appError.code);
  if (appError.code !== 'INTERNAL_ERROR') {
    metadata.set(ERROR_DETAILS_METADATA, JSON.stringify(appError.details));
  }
  return {
    code: GRPC_STATUS_BY_ERROR_CODE[appError.code],
    details: appError.code,
    metadata,
  };
}

function isServiceError(error: unknown): error is ServiceError {
  return typeof error === 'object' && error !== null && 'code' in error && 'metadata' in error;
}

export function fromGrpcError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  if (!isServiceError(error)) {
    return new AppError('INTERNAL_ERROR', {}, { cause: error });
  }
  const code = error.metadata.get(ERROR_CODE_METADATA)[0]?.toString();
  const rawDetails = error.metadata.get(ERROR_DETAILS_METADATA)[0]?.toString();
  let details: Record<string, unknown> = {};
  if (rawDetails) {
    try {
      details = JSON.parse(rawDetails) as Record<string, unknown>;
    } catch {
      details = {};
    }
  }
  const mapped: ErrorCode =
    code !== undefined && isErrorCode(code)
      ? code
      : (ERROR_CODE_BY_GRPC_STATUS[error.code] ?? 'INTERNAL_ERROR');
  return new AppError(mapped, details, { cause: error });
}
