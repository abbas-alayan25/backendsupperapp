import { describe, expect, it } from 'vitest';
import { logHashKeyFromEnv, portFromEnv } from './run-service.js';

describe('portFromEnv', () => {
  it('uses the fallback when unset', () => {
    expect(portFromEnv(undefined, 3000)).toBe(3000);
    expect(portFromEnv('', 3000)).toBe(3000);
  });

  it('parses valid ports', () => {
    expect(portFromEnv('4001', 3000)).toBe(4001);
    expect(portFromEnv('0', 3000)).toBe(0);
  });

  it.each(['-1', '65536', 'abc', '30.5'])('rejects %j', (value) => {
    expect(() => portFromEnv(value, 3000)).toThrow(RangeError);
  });
});

describe('logHashKeyFromEnv', () => {
  it('uses the configured key', () => {
    expect(logHashKeyFromEnv({ LOG_USER_ID_HASH_KEY: 'k1' })).toBe('k1');
  });

  it('falls back to a local key outside production', () => {
    expect(logHashKeyFromEnv({ NODE_ENV: 'development' })).toMatch(/local/);
  });

  it('requires a key in production', () => {
    expect(() => logHashKeyFromEnv({ NODE_ENV: 'production' })).toThrow(/required/);
  });
});
