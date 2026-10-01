import 'reflect-metadata';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ERROR_MESSAGES, createLogger, hashUserId, isUuidV7 } from '@super-app/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceApp } from '../src/index.js';
import { fixtureModule } from './fixtures/fixture.module.js';

const TENANT = '0192f5a0-0000-7000-8000-000000000001';
const HASH_KEY = 'nest-int-hash-key';

interface InjectOptions {
  method?: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  payload?: string;
  withTenant?: boolean;
}

describe('service app', () => {
  const lines: Record<string, unknown>[] = [];
  let app: NestFastifyApplication;

  const inject = (options: InjectOptions) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: options.method ?? 'GET',
        url: options.url,
        headers: {
          ...(options.withTenant === false ? {} : { 'x-tenant-id': TENANT }),
          ...options.headers,
        },
        ...(options.payload === undefined ? {} : { payload: options.payload }),
      });

  beforeAll(async () => {
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        }
        callback();
      },
    });
    const logger = createLogger({ service: 'fixture', userIdHashKey: HASH_KEY, destination });
    app = await createServiceApp(fixtureModule(logger), {
      logger,
      tenantExemptPaths: ['/health/live'],
      platformPathPrefixes: ['/platform'],
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests without a tenant', async () => {
    const response = await inject({ url: '/context', withTenant: false });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { reason: 'TENANT_UNRESOLVED' } },
    });
  });

  it('rejects a malformed tenant id', async () => {
    const response = await inject({ url: '/context', headers: { 'x-tenant-id': 'tenant-1' } });
    expect(response.statusCode).toBe(403);
  });

  it('localizes the missing-tenant error', async () => {
    const response = await inject({
      url: '/context',
      withTenant: false,
      headers: { 'accept-language': 'ar' },
    });
    expect(response.json()).toMatchObject({
      error: { message: ERROR_MESSAGES.FORBIDDEN.ar },
    });
  });

  it('opens a request context and logs with tenant, request and hashed user', async () => {
    const response = await inject({
      url: '/context',
      headers: { 'x-request-id': 'req-abc', 'accept-language': 'ar-JO' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-abc');
    expect(response.json()).toMatchObject({
      tenantId: TENANT,
      requestId: 'req-abc',
      locale: 'ar',
      userId: 'user-42',
    });
    const handled = lines.find((line) => line.message === 'handled');
    expect(handled).toMatchObject({
      tenant_id: TENANT,
      request_id: 'req-abc',
      user_id: hashUserId('user-42', HASH_KEY),
    });
  });

  it('generates a UUIDv7 request id when none or an invalid one is sent', async () => {
    const missing = await inject({ url: '/context' });
    expect(isUuidV7(String(missing.headers['x-request-id']))).toBe(true);
    const invalid = await inject({
      url: '/context',
      headers: { 'x-request-id': 'bad id <script>' },
    });
    expect(isUuidV7(String(invalid.headers['x-request-id']))).toBe(true);
  });

  it('maps AppError to the spec envelope and status', async () => {
    const response = await inject({ url: '/insufficient', headers: { 'x-request-id': 'req-422' } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient funds.',
        details: { walletId: 'w1' },
        requestId: 'req-422',
      },
    });
  });

  it('localizes error messages from Accept-Language', async () => {
    const response = await inject({ url: '/insufficient', headers: { 'accept-language': 'ar' } });
    expect(response.json()).toMatchObject({
      error: { message: ERROR_MESSAGES.INSUFFICIENT_FUNDS.ar },
    });
  });

  it('sets Retry-After when the error carries one', async () => {
    const response = await inject({ url: '/rate-limited' });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
  });

  it('hides unexpected errors behind INTERNAL_ERROR and logs them', async () => {
    const response = await inject({ url: '/boom', headers: { 'x-request-id': 'req-500' } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again later.',
        details: {},
        requestId: 'req-500',
      },
    });
    expect(response.body).not.toContain('hunter2');
    expect(lines.some((line) => line.level === 'error' && line.request_id === 'req-500')).toBe(
      true,
    );
  });

  it('maps unknown routes to NOT_FOUND', async () => {
    const response = await inject({ url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('maps malformed JSON to VALIDATION_FAILED', async () => {
    const response = await inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('runs platform routes in platform scope without a tenant header', async () => {
    const response = await inject({ url: '/platform/tenants', withTenant: false });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tenantId: '00000000-0000-0000-0000-000000000000',
      scope: 'platform',
    });
  });

  it('does not treat lookalike prefixes as platform routes', async () => {
    const response = await inject({ url: '/platformx', withTenant: false });
    expect(response.statusCode).toBe(403);
  });

  it('serves exempt paths without a tenant or context', async () => {
    const response = await inject({ url: '/health/live', withTenant: false });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', tenantId: null });
  });
});
