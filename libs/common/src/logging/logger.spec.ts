import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runWithContext, setContextPrincipal } from '../context/request-context.js';
import { createLogger, hashUserId } from './logger.js';

const HASH_KEY = 'log-hash-key';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  const logger = createLogger({ service: 'test-service', userIdHashKey: HASH_KEY, destination });
  return { logger, lines };
}

describe('createLogger', () => {
  it('adds tenant, request and hashed user ids from the request context', () => {
    const { logger, lines } = capture();
    runWithContext({ tenantId: 't1', requestId: 'r1', locale: 'en' }, () => {
      setContextPrincipal({ userId: 'user-123' });
      logger.info('hello');
    });
    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'test-service',
      message: 'hello',
      tenant_id: 't1',
      request_id: 'r1',
      user_id: hashUserId('user-123', HASH_KEY),
    });
    expect(JSON.stringify(lines[0])).not.toContain('user-123');
  });

  it('omits context fields when no context is active', () => {
    const { logger, lines } = capture();
    logger.info('boot');
    expect(lines[0]).not.toHaveProperty('tenant_id');
    expect(lines[0]).not.toHaveProperty('user_id');
  });

  it('redacts PII and secrets', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        phone: '+962791234567',
        body: { pin: '1234', email: 'a@b.co', amount: '10.00' },
        req: { headers: { authorization: 'Bearer abc', 'x-step-up-token': 'st-secret-9f2' } },
      },
      'request',
    );
    const line = JSON.stringify(lines[0]);
    for (const secret of ['+962791234567', '1234', 'a@b.co', 'Bearer abc', 'st-secret-9f2']) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('10.00');
    expect(lines[0]).toMatchObject({ phone: '[Redacted]', body: { pin: '[Redacted]' } });
  });

  it('hashes user ids deterministically per key', () => {
    expect(hashUserId('u', 'k1')).toBe(hashUserId('u', 'k1'));
    expect(hashUserId('u', 'k1')).not.toBe(hashUserId('u', 'k2'));
  });
});
