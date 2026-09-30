export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE_REQUEST',
  'INSUFFICIENT_FUNDS',
  'LIMIT_EXCEEDED',
  'KYC_REQUIRED',
  'STEP_UP_REQUIRED',
  'RISK_DECLINED',
  'RISK_REVIEW',
  'ACCOUNT_FROZEN',
  'SERVICE_DISABLED',
  'UPDATE_REQUIRED',
  'MAINTENANCE',
  'RATE_LIMITED',
  'PARTNER_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
