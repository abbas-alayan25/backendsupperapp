import type { ErrorCode } from './error-codes.js';
import { HTTP_STATUS_BY_ERROR_CODE } from './http-status.js';

export type ErrorDetails = Readonly<Record<string, unknown>>;

export interface AppErrorOptions {
  cause?: unknown;
  retryAfterSeconds?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, details: ErrorDetails = {}, options: AppErrorOptions = {}) {
    super(code, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get httpStatus(): number {
    return HTTP_STATUS_BY_ERROR_CODE[this.code];
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
