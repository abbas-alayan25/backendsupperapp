import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../i18n/locale.js';
import { AppError, isAppError } from './app-error.js';
import { ERROR_CODES, isErrorCode } from './error-codes.js';
import { toErrorEnvelope } from './error-envelope.js';
import { HTTP_STATUS_BY_ERROR_CODE, errorCodeForHttpStatus } from './http-status.js';
import { ERROR_MESSAGES } from './messages.js';

describe('error codes', () => {
  it('contains the 18 spec codes plus INTERNAL_ERROR', () => {
    expect(ERROR_CODES).toHaveLength(19);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it.each(ERROR_CODES)('%s has an HTTP status and messages in every locale', (code) => {
    const status = HTTP_STATUS_BY_ERROR_CODE[code];
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
    for (const locale of SUPPORTED_LOCALES) {
      expect(ERROR_MESSAGES[code][locale].length).toBeGreaterThan(0);
    }
    expect(ERROR_MESSAGES[code].ar).not.toBe(ERROR_MESSAGES[code].en);
  });

  it.each([
    ['VALIDATION_FAILED', 400],
    ['UNAUTHENTICATED', 401],
    ['STEP_UP_REQUIRED', 403],
    ['DUPLICATE_REQUEST', 409],
    ['INSUFFICIENT_FUNDS', 422],
    ['UPDATE_REQUIRED', 426],
    ['RATE_LIMITED', 429],
    ['INTERNAL_ERROR', 500],
    ['MAINTENANCE', 503],
  ] as const)('maps %s to %i', (code, status) => {
    expect(new AppError(code).httpStatus).toBe(status);
  });

  it('recognises error codes', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('SOMETHING_ELSE')).toBe(false);
  });

  it.each([
    [400, 'VALIDATION_FAILED'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [418, 'VALIDATION_FAILED'],
    [429, 'RATE_LIMITED'],
    [500, 'INTERNAL_ERROR'],
    [502, 'INTERNAL_ERROR'],
  ] as const)('maps HTTP %i to %s', (status, code) => {
    expect(errorCodeForHttpStatus(status)).toBe(code);
  });
});

describe('AppError', () => {
  it('carries details, cause and retry-after', () => {
    const cause = new Error('upstream');
    const error = new AppError('RATE_LIMITED', { scope: 'otp' }, { cause, retryAfterSeconds: 30 });
    expect(isAppError(error)).toBe(true);
    expect(error.details).toEqual({ scope: 'otp' });
    expect(error.cause).toBe(cause);
    expect(error.retryAfterSeconds).toBe(30);
  });
});

describe('error envelope', () => {
  it('has the spec shape', () => {
    const envelope = toErrorEnvelope(new AppError('NOT_FOUND', { id: 'x' }), 'en', 'req-1');
    expect(envelope).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        details: { id: 'x' },
        requestId: 'req-1',
      },
    });
  });

  it('localizes the message', () => {
    const envelope = toErrorEnvelope(new AppError('INSUFFICIENT_FUNDS'), 'ar', 'req-2');
    expect(envelope.error.message).toBe('الرصيد غير كافٍ.');
  });

  it('never exposes details of internal errors', () => {
    const envelope = toErrorEnvelope(
      new AppError('INTERNAL_ERROR', { sql: 'select secret' }),
      'en',
      'req-3',
    );
    expect(envelope.error.details).toEqual({});
  });
});
