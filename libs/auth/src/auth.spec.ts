import { type CryptoKey, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { AppError } from '@super-app/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { ipAllowed } from './auth.guard.js';
import { stepUpRequestHash } from './hashing.js';
import {
  canonicalSignatureString,
  signMerchantRequest,
  verifyMerchantSignature,
} from './merchant-signature.js';
import { JwtSigner, JwtVerifier } from './tokens.js';

const ISSUER = 'https://auth.tenant.test';
const TENANT = '0192f5a0-0000-7000-8000-000000000001';
let signer: JwtSigner;
let verifier: JwtVerifier;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { extractable: true });
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'EdDSA' };
  signer = new JwtSigner(pair.privateKey, 'k1', ISSUER);
  verifier = new JwtVerifier(createLocalJWKSet({ keys: [jwk] }), ISSUER);
});

async function reason(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).details.reason;
  }
  throw new Error('expected rejection');
}

describe('JWT tokens', () => {
  it('round-trips the spec claims', async () => {
    const token = await signer.sign(
      { tid: TENANT, sub: 'user-1', dev: 'device-1', typ: 'user' },
      { jti: 'j1' },
    );
    expect(await verifier.verify(token)).toMatchObject({
      tid: TENANT,
      sub: 'user-1',
      dev: 'device-1',
      typ: 'user',
      jti: 'j1',
    });
  });

  it('expires access tokens after 10 minutes by default', async () => {
    const token = await signer.sign(
      { tid: TENANT, sub: 'u', dev: 'd', typ: 'user' },
      { now: new Date(Date.now() - 11 * 60_000) },
    );
    expect(await reason(verifier.verify(token))).toBe('TOKEN_EXPIRED');
  });

  it('rejects other issuers, algorithms and tampering', async () => {
    const otherIssuer = new JwtSigner(privateKey, 'k1', 'https://evil.test');
    expect(
      await reason(
        verifier.verify(await otherIssuer.sign({ tid: TENANT, sub: 'u', dev: 'd', typ: 'user' })),
      ),
    ).toBe('TOKEN_INVALID');
    const hs = await new SignJWT({ tid: TENANT, dev: 'd', typ: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    expect(await reason(verifier.verify(hs))).toBe('TOKEN_INVALID');
    const token = await signer.sign({ tid: TENANT, sub: 'u', dev: 'd', typ: 'user' });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ tid: TENANT, sub: 'admin', dev: 'd', typ: 'user', iss: ISSUER, exp: 9e9 }),
    ).toString('base64url');
    expect(await reason(verifier.verify(`${header ?? ''}.${forged}.${signature ?? ''}`))).toBe(
      'TOKEN_INVALID',
    );
  });

  it('rejects tokens with missing or invalid claims', async () => {
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
        .setSubject('u')
        .setIssuer(ISSUER)
        .setExpirationTime('5m')
        .sign(privateKey);
    for (const claims of [
      { dev: 'd', typ: 'user' },
      { tid: 'not-a-uuid', dev: 'd', typ: 'user' },
      { tid: TENANT, typ: 'user' },
      { tid: TENANT, dev: 'd', typ: 'admin' },
    ]) {
      expect(await reason(verifier.verify(await sign(claims)))).toBe('TOKEN_INVALID');
    }
  });
});

describe('step-up request hash', () => {
  it('binds method, path with query and body', () => {
    const base = stepUpRequestHash('post', '/mobile/v1/payments/p2p?x=1', '{"amount":"1.00"}');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(
      stepUpRequestHash('POST', '/mobile/v1/payments/p2p?x=1', Buffer.from('{"amount":"1.00"}')),
    ).toBe(base);
    expect(stepUpRequestHash('POST', '/mobile/v1/payments/p2p?x=2', '{"amount":"1.00"}')).not.toBe(
      base,
    );
    expect(stepUpRequestHash('POST', '/mobile/v1/payments/p2p?x=1', '{"amount":"2.00"}')).not.toBe(
      base,
    );
    expect(stepUpRequestHash('POST', '/mobile/v1/payments/p2p', undefined)).toBe(
      stepUpRequestHash('POST', '/mobile/v1/payments/p2p', ''),
    );
  });
});

describe('merchant signatures', () => {
  const key = 'sk_live_secret';
  const now = new Date('2026-09-30T12:00:00Z');
  const input = {
    method: 'POST',
    pathWithQuery: '/merchant/v1/refunds',
    timestamp: String(Math.floor(now.getTime() / 1000)),
    rawBody: '{"paymentId":"p1"}',
  };

  it('verifies a signature over method, path, timestamp and body hash', () => {
    expect(canonicalSignatureString(input).split('\n')).toHaveLength(4);
    const signature = signMerchantRequest(key, input);
    expect(verifyMerchantSignature(key, input, signature, now)).toEqual({ valid: true });
    expect(verifyMerchantSignature(key, input, signature.toUpperCase(), now)).toEqual({
      valid: true,
    });
  });

  it('rejects tampering, wrong keys and bad signatures', () => {
    const signature = signMerchantRequest(key, input);
    expect(
      verifyMerchantSignature(key, { ...input, rawBody: '{"paymentId":"p2"}' }, signature, now),
    ).toEqual({
      valid: false,
      reason: 'SIGNATURE_MISMATCH',
    });
    expect(verifyMerchantSignature('other-secret', input, signature, now).valid).toBe(false);
    expect(verifyMerchantSignature(key, input, 'zz', now).valid).toBe(false);
  });

  it('accepts either secret while a key is being rotated', () => {
    const previous = signMerchantRequest('old-secret', input);
    const current = signMerchantRequest('new-secret', input);
    expect(verifyMerchantSignature(['new-secret', 'old-secret'], input, previous, now).valid).toBe(
      true,
    );
    expect(verifyMerchantSignature(['new-secret', 'old-secret'], input, current, now).valid).toBe(
      true,
    );
    expect(verifyMerchantSignature(['new-secret'], input, previous, now)).toEqual({
      valid: false,
      reason: 'SIGNATURE_MISMATCH',
    });
  });

  it('enforces the 5-minute skew and numeric timestamps', () => {
    const signature = signMerchantRequest(key, input);
    expect(
      verifyMerchantSignature(key, input, signature, new Date(now.getTime() + 299_000)).valid,
    ).toBe(true);
    expect(
      verifyMerchantSignature(key, input, signature, new Date(now.getTime() + 301_000)),
    ).toEqual({
      valid: false,
      reason: 'TIMESTAMP_SKEW',
    });
    expect(
      verifyMerchantSignature(key, { ...input, timestamp: '2026-09-30' }, signature, now),
    ).toEqual({
      valid: false,
      reason: 'TIMESTAMP_INVALID',
    });
  });
});

describe('IP allowlists', () => {
  it('allows everything when empty and matches addresses and subnets', () => {
    expect(ipAllowed('203.0.113.9', [])).toBe(true);
    expect(ipAllowed('203.0.113.9', ['203.0.113.9'])).toBe(true);
    expect(ipAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(ipAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
  });
});
