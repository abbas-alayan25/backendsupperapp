import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import {
  AppError,
  type Locale,
  type Logger,
  currentContext,
  errorCodeForHttpStatus,
  isAppError,
  resolveLocale,
  toErrorEnvelope,
} from '@super-app/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENT_REPLAYED_HEADER, IdempotentReplay } from '../idempotency/idempotent-replay.js';

function statusCodeOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (typeof exception === 'object' && exception !== null && 'statusCode' in exception) {
    return typeof exception.statusCode === 'number' ? exception.statusCode : undefined;
  }
  return undefined;
}

export function toAppError(exception: unknown): AppError {
  if (isAppError(exception)) {
    return exception;
  }
  const status = statusCodeOf(exception);
  if (status === undefined) {
    return new AppError('INTERNAL_ERROR', {}, { cause: exception });
  }
  return new AppError(errorCodeForHttpStatus(status), {}, { cause: exception });
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    private readonly defaultLocale: Locale,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (exception instanceof IdempotentReplay) {
      void reply
        .header(IDEMPOTENT_REPLAYED_HEADER, 'true')
        .status(exception.status)
        .send(exception.body);
      return;
    }
    const error = toAppError(exception);
    if (error.httpStatus >= 500) {
      this.logger.error({ err: exception }, 'request failed');
    }
    const acceptLanguage: unknown = request.headers['accept-language'];
    const locale =
      currentContext()?.locale ??
      resolveLocale(
        typeof acceptLanguage === 'string' ? acceptLanguage : undefined,
        this.defaultLocale,
      );
    if (error.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(error.retryAfterSeconds));
    }
    void reply.status(error.httpStatus).send(toErrorEnvelope(error, locale, request.id));
  }
}
