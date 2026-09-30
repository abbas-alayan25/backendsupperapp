import 'reflect-metadata';
import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppError, createLogger, newId } from '@super-app/common';
import type { BeginResult, IdempotencyRequest } from '@super-app/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_PORT,
  Idempotent,
  IdempotencyInterceptor,
  type IdempotencyPort,
  createServiceApp,
} from '../src/index.js';

interface Stored {
  actor: string;
  hash: string;
  status: number;
  body: unknown;
}

class MemoryStore implements IdempotencyPort {
  readonly stored = new Map<string, Stored>();
  readonly locks = new Set<string>();
  abandoned = 0;

  begin(request: IdempotencyRequest): Promise<BeginResult> {
    const id = `${request.tenantId}:${request.key}`;
    const found = this.stored.get(id);
    const actor = `${request.actor.type}:${request.actor.id}`;
    if (found) {
      if (found.actor !== actor) return Promise.reject(new AppError('CONFLICT'));
      if (found.hash !== request.requestHash)
        return Promise.reject(new AppError('DUPLICATE_REQUEST'));
      return Promise.resolve({ kind: 'replay', status: found.status, body: found.body });
    }
    if (this.locks.has(id)) {
      return Promise.reject(new AppError('CONFLICT', {}, { retryAfterSeconds: 1 }));
    }
    this.locks.add(id);
    return Promise.resolve({ kind: 'proceed', lockToken: id });
  }

  complete(
    request: IdempotencyRequest,
    lockToken: string,
    response: { status: number; body: unknown },
  ) {
    this.stored.set(lockToken, {
      actor: `${request.actor.type}:${request.actor.id}`,
      hash: request.requestHash,
      ...response,
    });
    this.locks.delete(lockToken);
    return Promise.resolve();
  }

  abandon(_request: IdempotencyRequest, lockToken: string) {
    this.abandoned += 1;
    this.locks.delete(lockToken);
    return Promise.resolve();
  }
}

let calls = 0;

@Controller()
class PaymentsController {
  @Post('payments/p2p')
  @Idempotent()
  p2p(@Body() body: { amount: string; fail?: 'funds' | 'crash' }): {
    paymentId: string;
    call: number;
  } {
    calls += 1;
    if (body.fail === 'funds') throw new AppError('INSUFFICIENT_FUNDS');
    if (body.fail === 'crash') throw new Error('database unavailable');
    return { paymentId: `p-${String(calls)}`, call: calls };
  }

  @Post('payments/requests/decline')
  @HttpCode(200)
  @Idempotent({ required: false })
  decline(): { declined: boolean } {
    calls += 1;
    return { declined: true };
  }
}

const TENANT = '0192f5a0-0000-7000-8000-000000000001';

describe('idempotency interceptor', () => {
  const store = new MemoryStore();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    @Module({
      controllers: [PaymentsController],
      providers: [
        { provide: IDEMPOTENCY_PORT, useValue: store },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    })
    class TestModule {}
    app = await createServiceApp(TestModule, {
      logger: createLogger({ service: 'idem-test', userIdHashKey: 'k', level: 'silent' }),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls = 0;
  });

  const post = (url: string, key: string | undefined, payload: object) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url,
        payload,
        headers: {
          'x-tenant-id': TENANT,
          'content-type': 'application/json',
          ...(key ? { 'idempotency-key': key } : {}),
        },
      });

  it('requires the key on money-moving POSTs', async () => {
    const response = await post('/payments/p2p', undefined, { amount: '1.00' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { field: 'Idempotency-Key', reason: 'REQUIRED' },
      },
    });
    expect(calls).toBe(0);
  });

  it('rejects keys that are not UUIDs', async () => {
    const response = await post('/payments/p2p', 'abc', { amount: '1.00' });
    expect(response.statusCode).toBe(400);
  });

  it('replays the first response without running the handler again', async () => {
    const key = newId();
    const first = await post('/payments/p2p', key, { amount: '1.00' });
    const second = await post('/payments/p2p', key, { amount: '1.00' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('returns DUPLICATE_REQUEST when the body changes', async () => {
    const key = newId();
    await post('/payments/p2p', key, { amount: '1.00' });
    const response = await post('/payments/p2p', key, { amount: '2.00' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'DUPLICATE_REQUEST' } });
  });

  it('stores and replays 4xx business errors', async () => {
    const key = newId();
    const first = await post('/payments/p2p', key, { amount: '1.00', fail: 'funds' });
    const second = await post('/payments/p2p', key, { amount: '1.00', fail: 'funds' });
    expect(first.statusCode).toBe(422);
    expect(second.statusCode).toBe(422);
    expect(second.json()).toEqual(first.json());
    expect(calls).toBe(1);
  });

  it('does not store 5xx so the client can retry', async () => {
    const key = newId();
    const abandonedBefore = store.abandoned;
    const first = await post('/payments/p2p', key, { amount: '1.00', fail: 'crash' });
    expect(first.statusCode).toBe(500);
    expect(store.abandoned).toBe(abandonedBefore + 1);
    const retry = await post('/payments/p2p', key, { amount: '1.00', fail: 'crash' });
    expect(retry.statusCode).toBe(500);
    expect(calls).toBe(2);
  });

  it('returns CONFLICT with Retry-After while a request is in flight', async () => {
    const key = newId();
    store.locks.add(`${TENANT}:${key}`);
    const response = await post('/payments/p2p', key, { amount: '1.00' });
    expect(response.statusCode).toBe(409);
    expect(response.headers['retry-after']).toBe('1');
    expect(calls).toBe(0);
  });

  it('treats the key as optional elsewhere and honours it when sent', async () => {
    const withoutKey = await post('/payments/requests/decline', undefined, {});
    expect(withoutKey.statusCode).toBe(200);
    const key = newId();
    await post('/payments/requests/decline', key, {});
    const replay = await post('/payments/requests/decline', key, {});
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(calls).toBe(2);
  });
});
