import 'reflect-metadata';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger, currentContext } from '@super-app/common';
import { HealthModule, createServiceApp } from '@super-app/nest';
import { createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AdminPrincipal,
  Auth,
  AuthModule,
  JwtSigner,
  JwtVerifier,
  RequirePermission,
  type ResolvedApiKey,
  type StepUpVerification,
  type TokenClaims,
  signMerchantRequest,
  signingKeyFromApiKey,
  stepUpRequestHash,
} from '../src/index.js';

const ISSUER = 'https://auth.test';
const TENANT = '0192f5a0-0000-7000-8000-000000000001';
const OTHER_TENANT = '0192f5a0-0000-7000-8000-000000000002';
const DEVICE = 'device-1';
const API_KEY = 'sk_test_merchant';
const NOW = new Date();

const actor = () => ({
  actor: currentContext()?.actor ?? null,
  userId: currentContext()?.userId ?? null,
});

@Controller()
class RoutesController {
  @Get('undeclared')
  undeclared() {
    return { ok: true };
  }

  @Get('public')
  @Auth('Public')
  publicRoute() {
    return { ok: true };
  }

  @Get('user')
  @Auth('User')
  user() {
    return actor();
  }

  @Post('register')
  @Auth('Reg')
  register() {
    return actor();
  }

  @Post('pay')
  @Auth('Step-up')
  pay(@Body() body: unknown) {
    return { ...actor(), body };
  }

  @Get('staff')
  @Auth('Staff')
  staff() {
    return actor();
  }

  @Get('rider')
  @Auth('Rider')
  rider() {
    return actor();
  }

  @Post('merchant/refunds')
  @Auth('Key')
  refund() {
    return actor();
  }

  @Get('admin/kyc')
  @RequirePermission('kyc.view')
  adminKyc() {
    return actor();
  }
}

const stepUpVerifier = {
  calls: [] as StepUpVerification[],
  verify(request: StepUpVerification) {
    this.calls.push(request);
    return Promise.resolve(request.token === `step:${request.requestHash}`);
  },
};

const apiKey: ResolvedApiKey = {
  apiKeyId: 'key-1',
  ownerType: 'MERCHANT',
  ownerId: 'merchant-1',
  signingKey: signingKeyFromApiKey(API_KEY),
  scopes: [],
  ipAllowlist: [],
};

const admins: Record<string, AdminPrincipal> = {
  'kyc-agent': {
    adminUserId: 'admin-1',
    tenantId: TENANT,
    scope: 'TENANT',
    permissions: new Set(['kyc.view']),
  },
  support: {
    adminUserId: 'admin-2',
    tenantId: TENANT,
    scope: 'TENANT',
    permissions: new Set(['support.view']),
  },
  'other-tenant': {
    adminUserId: 'admin-3',
    tenantId: OTHER_TENANT,
    scope: 'TENANT',
    permissions: new Set(['kyc.view']),
  },
};

let app: NestFastifyApplication;
let signer: JwtSigner;
let allowlist: string[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA');
  signer = new JwtSigner(pair.privateKey, 'k1', ISSUER);
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'EdDSA' };
  @Module({
    imports: [
      HealthModule.forRoot(),
      AuthModule.forRoot({
        jwtVerifier: new JwtVerifier(createLocalJWKSet({ keys: [jwk] }), ISSUER),
        stepUpVerifier,
        apiKeyResolver: {
          resolve: (tenantId, prefix) =>
            Promise.resolve(
              tenantId === TENANT && prefix === 'pk_1'
                ? { ...apiKey, ipAllowlist: allowlist }
                : undefined,
            ),
        },
        adminPrincipalResolver: { resolve: (token) => Promise.resolve(admins[token]) },
        clock: () => NOW,
      }),
    ],
    controllers: [RoutesController],
  })
  class TestModule {}
  app = await createServiceApp(TestModule, {
    logger: createLogger({ service: 'auth-test', userIdHashKey: 'k', level: 'silent' }),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

const token = (claims: Partial<TokenClaims> = {}) =>
  signer.sign({ tid: TENANT, sub: 'user-1', dev: DEVICE, typ: 'user', ...claims });

const call = (options: {
  method?: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  payload?: string;
  tenant?: string;
}) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: options.method ?? 'GET',
      url: options.url,
      payload: options.payload,
      headers: {
        'x-tenant-id': options.tenant ?? TENANT,
        ...(options.payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
    });

const bearer = async (claims: Partial<TokenClaims> = {}, device = DEVICE) => ({
  authorization: `Bearer ${await token(claims)}`,
  'x-device-id': device,
});

describe('route declarations', () => {
  it('denies routes that declare no auth level', async () => {
    const response = await call({ url: '/undeclared' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'NO_AUTH_LEVEL' } } });
  });

  it('serves public routes and health probes without a token', async () => {
    expect((await call({ url: '/public' })).statusCode).toBe(200);
    expect((await call({ url: '/health' })).statusCode).toBe(200);
    expect((await call({ url: '/ready' })).statusCode).toBe(200);
  });
});

describe('customer tokens', () => {
  it('accepts a valid user token and records the user as the actor', async () => {
    const response = await call({ url: '/user', headers: await bearer() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ actor: { type: 'USER', id: 'user-1' }, userId: 'user-1' });
  });

  it('requires a bearer token', async () => {
    const response = await call({ url: '/user' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'UNAUTHENTICATED', details: { reason: 'MISSING_TOKEN' } },
    });
  });

  it('rejects a token issued for another tenant', async () => {
    const response = await call({ url: '/user', headers: await bearer({ tid: OTHER_TENANT }) });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'TENANT_MISMATCH' } } });
  });

  it('rejects a token used from another device', async () => {
    const response = await call({ url: '/user', headers: await bearer({}, 'device-2') });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'DEVICE_MISMATCH' } } });
  });

  it('only accepts the token type the route requires', async () => {
    expect((await call({ url: '/user', headers: await bearer({ typ: 'reg' }) })).statusCode).toBe(
      403,
    );
    expect(
      (await call({ method: 'POST', url: '/register', headers: await bearer({ typ: 'reg' }) }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call({ url: '/staff', headers: await bearer({ typ: 'staff' }) })).statusCode,
    ).toBe(200);
    expect((await call({ url: '/staff', headers: await bearer({ typ: 'user' }) })).statusCode).toBe(
      403,
    );
    expect(
      (await call({ url: '/rider', headers: await bearer({ typ: 'rider' }) })).statusCode,
    ).toBe(200);
  });
});

describe('step-up', () => {
  const payload = '{"amount":"10.00","currency":"USD"}';

  it('requires a step-up token', async () => {
    const response = await call({ method: 'POST', url: '/pay', payload, headers: await bearer() });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'STEP_UP_REQUIRED' } });
  });

  it('accepts a step-up token bound to this exact request', async () => {
    const hash = stepUpRequestHash('POST', '/pay', payload);
    const response = await call({
      method: 'POST',
      url: '/pay',
      payload,
      headers: { ...(await bearer()), 'x-step-up-token': `step:${hash}` },
    });
    expect(response.statusCode).toBe(201);
    expect(stepUpVerifier.calls.at(-1)).toMatchObject({
      tenantId: TENANT,
      userId: 'user-1',
      deviceId: DEVICE,
      requestHash: hash,
    });
  });

  it('rejects a step-up token issued for a different body', async () => {
    const hash = stepUpRequestHash('POST', '/pay', '{"amount":"1.00","currency":"USD"}');
    const response = await call({
      method: 'POST',
      url: '/pay',
      payload,
      headers: { ...(await bearer()), 'x-step-up-token': `step:${hash}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { details: { reason: 'STEP_UP_TOKEN_INVALID' } },
    });
  });
});

describe('merchant API keys', () => {
  const payload = '{"paymentId":"p1"}';
  const signed = (
    body: string,
    timestamp = String(Math.floor(NOW.getTime() / 1000)),
    signBody = body,
  ) => ({
    'x-key-id': 'pk_1',
    'x-timestamp': timestamp,
    'x-signature': signMerchantRequest(apiKey.signingKey, {
      method: 'POST',
      pathWithQuery: '/merchant/refunds',
      timestamp,
      rawBody: signBody,
    }),
  });

  it('accepts a correctly signed request and records the API key as the actor', async () => {
    allowlist = [];
    const response = await call({
      method: 'POST',
      url: '/merchant/refunds',
      payload,
      headers: signed(payload),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ actor: { type: 'API_KEY', id: 'key-1' }, userId: null });
  });

  it('rejects a tampered body', async () => {
    const response = await call({
      method: 'POST',
      url: '/merchant/refunds',
      payload,
      headers: signed(payload, undefined, '{"paymentId":"p2"}'),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'SIGNATURE_MISMATCH' } } });
  });

  it('rejects stale timestamps', async () => {
    const stale = String(Math.floor(NOW.getTime() / 1000) - 600);
    const response = await call({
      method: 'POST',
      url: '/merchant/refunds',
      payload,
      headers: signed(payload, stale),
    });
    expect(response.json()).toMatchObject({ error: { details: { reason: 'TIMESTAMP_SKEW' } } });
  });

  it('rejects unknown keys and keys from another tenant', async () => {
    const headers = { ...signed(payload), 'x-key-id': 'pk_unknown' };
    expect(
      (await call({ method: 'POST', url: '/merchant/refunds', payload, headers })).statusCode,
    ).toBe(401);
    expect(
      (
        await call({
          method: 'POST',
          url: '/merchant/refunds',
          payload,
          headers: signed(payload),
          tenant: OTHER_TENANT,
        })
      ).statusCode,
    ).toBe(401);
  });

  it('enforces the key IP allowlist', async () => {
    allowlist = ['198.51.100.0/24'];
    const response = await call({
      method: 'POST',
      url: '/merchant/refunds',
      payload,
      headers: signed(payload),
    });
    allowlist = [];
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { details: { reason: 'IP_NOT_ALLOWED' } } });
  });
});

describe('admin permissions', () => {
  it('allows staff with the permission', async () => {
    const response = await call({
      url: '/admin/kyc',
      headers: { authorization: 'Bearer kyc-agent' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ actor: { type: 'ADMIN', id: 'admin-1' }, userId: null });
  });

  it('denies staff without the permission', async () => {
    const response = await call({
      url: '/admin/kyc',
      headers: { authorization: 'Bearer support' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { details: { reason: 'PERMISSION_REQUIRED', permission: 'kyc.view' } },
    });
  });

  it('denies tenant staff acting on another tenant', async () => {
    const response = await call({
      url: '/admin/kyc',
      headers: { authorization: 'Bearer other-tenant' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects unknown admin sessions', async () => {
    expect(
      (await call({ url: '/admin/kyc', headers: { authorization: 'Bearer nobody' } })).statusCode,
    ).toBe(401);
  });
});
