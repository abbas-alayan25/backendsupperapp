import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import {
  type Actor,
  AppError,
  firstHeader,
  isUuid,
  requireContext,
  toErrorEnvelope,
} from '@super-app/common';
import type { BeginResult, IdempotencyRequest } from '@super-app/db';
import { requestHash } from '@super-app/db';
import type { FastifyRequest } from 'fastify';
import { type Observable, catchError, from, mergeMap } from 'rxjs';
import { toAppError } from '../errors/app-exception.filter.js';
import { IDEMPOTENCY_METADATA, type IdempotencyOptions } from './idempotent.decorator.js';
import { IdempotentReplay } from './idempotent-replay.js';

export const IDEMPOTENCY_PORT = Symbol('IDEMPOTENCY_PORT');
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface IdempotencyPort {
  begin(request: IdempotencyRequest): Promise<BeginResult>;
  complete(
    request: IdempotencyRequest,
    lockToken: string,
    response: { status: number; body: unknown },
  ): Promise<void>;
  abandon(request: IdempotencyRequest, lockToken: string): Promise<void>;
}

const ANONYMOUS_ACTOR: Actor = { type: 'USER', id: 'anonymous' };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_PORT) private readonly store: IdempotencyPort,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.method !== 'POST') {
      return next.handle();
    }
    const options = this.reflector.getAllAndOverride<IdempotencyOptions | undefined>(
      IDEMPOTENCY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    const key = firstHeader(request.headers[IDEMPOTENCY_HEADER]);
    if (key === undefined) {
      if (options?.required) {
        throw new AppError('VALIDATION_FAILED', { field: 'Idempotency-Key', reason: 'REQUIRED' });
      }
      return next.handle();
    }
    if (!isUuid(key)) {
      throw new AppError('VALIDATION_FAILED', { field: 'Idempotency-Key', reason: 'INVALID_UUID' });
    }
    const requestContext = requireContext();
    const idempotencyRequest: IdempotencyRequest = {
      tenantId: requestContext.tenantId,
      key,
      actor: requestContext.actor ?? ANONYMOUS_ACTOR,
      requestHash: requestHash({ method: request.method, path: request.url, body: request.body }),
    };
    const begin = await this.store.begin(idempotencyRequest);
    if (begin.kind === 'replay') {
      throw new IdempotentReplay(begin.status, begin.body);
    }
    const { lockToken } = begin;
    const successStatus =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      HttpStatus.CREATED;
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        await this.store.complete(idempotencyRequest, lockToken, { status: successStatus, body });
        return body;
      }),
      catchError((error: unknown) =>
        from(
          (async () => {
            const appError = toAppError(error);
            if (appError.httpStatus < 500) {
              await this.store.complete(idempotencyRequest, lockToken, {
                status: appError.httpStatus,
                body: toErrorEnvelope(appError, requestContext.locale, requestContext.requestId),
              });
            } else {
              await this.store.abandon(idempotencyRequest, lockToken);
            }
            throw error;
          })(),
        ),
      ),
    );
  }
}
