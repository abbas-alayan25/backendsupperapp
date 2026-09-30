import { describe, expect, it } from 'vitest';
import {
  MissingRequestContextError,
  currentContext,
  requireTenantId,
  runWithContext,
  setContextPrincipal,
} from './request-context.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('request context', () => {
  it('is absent outside a run', () => {
    expect(currentContext()).toBeUndefined();
    expect(() => requireTenantId()).toThrow(MissingRequestContextError);
  });

  it('isolates concurrent async flows', async () => {
    const observe = (tenantId: string, delay: number) =>
      runWithContext({ tenantId, requestId: `r-${tenantId}`, locale: 'en' }, async () => {
        await pause(delay);
        const first = requireTenantId();
        await pause(delay);
        return [first, requireTenantId(), currentContext()?.requestId];
      });
    const results = await Promise.all([observe('t1', 15), observe('t2', 5), observe('t3', 10)]);
    expect(results).toEqual([
      ['t1', 't1', 'r-t1'],
      ['t2', 't2', 'r-t2'],
      ['t3', 't3', 'r-t3'],
    ]);
  });

  it('records the principal on the active context only', async () => {
    const original = { tenantId: 't1', requestId: 'r1', locale: 'ar' as const };
    await runWithContext(original, async () => {
      await pause(1);
      setContextPrincipal({ userId: 'u1', deviceId: 'd1' });
      expect(currentContext()).toMatchObject({ userId: 'u1', deviceId: 'd1', locale: 'ar' });
    });
    expect(original).not.toHaveProperty('userId');
  });

  it('refuses to set a principal outside a context', () => {
    expect(() => {
      setContextPrincipal({ userId: 'u1' });
    }).toThrow(MissingRequestContextError);
  });
});
