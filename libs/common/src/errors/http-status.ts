import type { ErrorCode } from './error-codes.js';

export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_REQUEST: 409,
  INSUFFICIENT_FUNDS: 422,
  LIMIT_EXCEEDED: 422,
  KYC_REQUIRED: 403,
  STEP_UP_REQUIRED: 403,
  RISK_DECLINED: 422,
  RISK_REVIEW: 422,
  ACCOUNT_FROZEN: 403,
  SERVICE_DISABLED: 403,
  UPDATE_REQUIRED: 426,
  MAINTENANCE: 503,
  RATE_LIMITED: 429,
  PARTNER_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export function errorCodeForHttpStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 413:
    case 415:
    case 422:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
    case 405:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 400 && status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR';
  }
}
