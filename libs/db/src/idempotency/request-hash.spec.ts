import { describe, expect, it } from 'vitest';
import { canonicalJson, requestHash } from './request-hash.js';

describe('requestHash', () => {
  it('is stable across key order', () => {
    const a = requestHash({
      method: 'post',
      path: '/p',
      body: { b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } },
    });
    const b = requestHash({
      method: 'POST',
      path: '/p',
      body: { a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the body, path or method', () => {
    const base = { method: 'POST', path: '/payments/p2p', body: { amount: '10.00' } };
    const hash = requestHash(base);
    expect(requestHash({ ...base, body: { amount: '10.01' } })).not.toBe(hash);
    expect(requestHash({ ...base, path: '/payments/qr/pay' })).not.toBe(hash);
    expect(requestHash({ ...base, method: 'PUT' })).not.toBe(hash);
  });

  it('keeps array order significant', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(undefined)).toBe('null');
  });
});
