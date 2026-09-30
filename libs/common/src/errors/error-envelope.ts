import type { Locale } from '../i18n/locale.js';
import type { AppError, ErrorDetails } from './app-error.js';
import type { ErrorCode } from './error-codes.js';
import { errorMessage } from './messages.js';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetails;
    requestId: string;
  };
}

export function toErrorEnvelope(error: AppError, locale: Locale, requestId: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: errorMessage(error.code, locale),
      details: error.code === 'INTERNAL_ERROR' ? {} : error.details,
      requestId,
    },
  };
}
