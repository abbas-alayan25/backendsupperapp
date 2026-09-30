import { describe, expect, it } from 'vitest';
import { type ReadinessCheck, evaluateReadiness } from './readiness.js';

const passing = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve() });
const failing = (name: string): ReadinessCheck => ({
  name,
  check: () => Promise.reject(new Error('connection refused to db.internal')),
});
const hanging = (name: string): ReadinessCheck => ({
  name,
  check: () => new Promise<void>(() => undefined),
});

describe('evaluateReadiness', () => {
  it('is ready with no checks', async () => {
    expect(await evaluateReadiness([])).toEqual({ status: 'ok', checks: {} });
  });

  it('is ready when every check passes', async () => {
    expect(await evaluateReadiness([passing('db'), passing('redis')])).toEqual({
      status: 'ok',
      checks: { db: 'ok', redis: 'ok' },
    });
  });

  it('is unavailable when any check fails, without exposing the error', async () => {
    const report = await evaluateReadiness([passing('db'), failing('redis')]);
    expect(report).toEqual({ status: 'unavailable', checks: { db: 'ok', redis: 'failed' } });
    expect(JSON.stringify(report)).not.toContain('db.internal');
  });

  it('times out hanging checks', async () => {
    const report = await evaluateReadiness([hanging('kafka'), passing('db')], 20);
    expect(report).toEqual({ status: 'unavailable', checks: { kafka: 'timeout', db: 'ok' } });
  });

  it('treats synchronous throws as failures', async () => {
    const throwing: ReadinessCheck = {
      name: 'broken',
      check: () => {
        throw new Error('boom');
      },
    };
    expect(await evaluateReadiness([throwing])).toEqual({
      status: 'unavailable',
      checks: { broken: 'failed' },
    });
  });
});
