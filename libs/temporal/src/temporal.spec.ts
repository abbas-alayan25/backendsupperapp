import { isUuid } from '@super-app/common';
import { describe, expect, it } from 'vitest';
import { activityIdempotencyKey } from './activity.js';
import { tenantWorkflowId } from './client.js';

describe('activityIdempotencyKey', () => {
  const identity = { workflowId: 'w1', runId: 'r1', activityId: '1' };

  it('is a deterministic UUID for the same activity', () => {
    const key = activityIdempotencyKey(identity);
    expect(isUuid(key)).toBe(true);
    expect(activityIdempotencyKey({ ...identity })).toBe(key);
  });

  it('differs per activity, run and workflow', () => {
    const key = activityIdempotencyKey(identity);
    expect(activityIdempotencyKey({ ...identity, activityId: '2' })).not.toBe(key);
    expect(activityIdempotencyKey({ ...identity, runId: 'r2' })).not.toBe(key);
    expect(activityIdempotencyKey({ ...identity, workflowId: 'w2' })).not.toBe(key);
  });
});

describe('tenantWorkflowId', () => {
  it('prefixes workflow ids with the tenant', () => {
    expect(
      tenantWorkflowId('0192f5a0-0000-7000-8000-000000000001', 'CardTopUpWorkflow', 'p1'),
    ).toBe('0192f5a0-0000-7000-8000-000000000001:CardTopUpWorkflow:p1');
  });

  it('rejects invalid tenants', () => {
    expect(() => tenantWorkflowId('tenant-1', 'CardTopUpWorkflow', 'p1')).toThrow(RangeError);
  });
});
