import { createHmac } from 'node:crypto';
import { type DestinationStream, type Logger, type LoggerOptions, pino } from 'pino';
import { currentContext } from '../context/request-context.js';

export type { Logger } from 'pino';

const SENSITIVE_FIELDS = [
  'phone',
  'phoneNumber',
  'email',
  'pin',
  'newPin',
  'password',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'stepUpToken',
  'iban',
  'accountNumber',
  'pan',
  'cvv',
  'dob',
  'firstName',
  'lastName',
  'fullName',
  'idNumber',
  'phone_enc',
  'email_enc',
  'dob_enc',
] as const;

export const DEFAULT_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-step-up-token"]',
  'req.headers["x-signature"]',
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((field) => `*.${field}`),
];

export interface CreateLoggerOptions {
  service: string;
  userIdHashKey: string | Uint8Array;
  level?: string;
  redactPaths?: readonly string[];
  destination?: DestinationStream;
}

export function hashUserId(userId: string, key: string | Uint8Array): string {
  return createHmac('sha256', key).update(userId).digest('hex').slice(0, 32);
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service: options.service },
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: { paths: [...DEFAULT_REDACT_PATHS, ...(options.redactPaths ?? [])] },
    mixin: () => {
      const context = currentContext();
      if (!context) {
        return {};
      }
      return {
        tenant_id: context.tenantId,
        request_id: context.requestId,
        ...(context.userId ? { user_id: hashUserId(context.userId, options.userIdHashKey) } : {}),
      };
    },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
