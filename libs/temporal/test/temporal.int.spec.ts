import { fileURLToPath } from 'node:url';
import { currentContext } from '@super-app/common';
import { type TemporalFixture, startTemporal, twoTenants } from '@super-app/testing';
import { Context } from '@temporalio/activity';
import type { Client } from '@temporalio/client';
import type { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activityIdempotencyKey,
  createTemporalClient,
  createTenantWorker,
  startTenantWorkflow,
} from '../src/index.js';
import type { TestActivities } from './activity-types.js';
import { postingWorkflow } from './workflows.js';

interface Attempt {
  tenantId: string | undefined;
  key: string;
  attempt: number;
}

const TASK_QUEUE = 'libs-temporal-test';
const attempts: Attempt[] = [];
const activities: TestActivities = {
  record(amount: string) {
    const key = activityIdempotencyKey();
    const attempt = Context.current().info.attempt;
    attempts.push({ tenantId: currentContext()?.tenantId, key, attempt });
    if (attempt === 1) {
      return Promise.reject(new Error('transient failure'));
    }
    return Promise.resolve(`${amount}:${key}`);
  },
};

let temporal: TemporalFixture;
let client: Client;
let worker: Worker;
let running: Promise<void>;
const { tenantA } = twoTenants();

beforeAll(async () => {
  temporal = await startTemporal();
  client = await createTemporalClient({ address: temporal.address, namespace: temporal.namespace });
  worker = await createTenantWorker({
    address: temporal.address,
    namespace: temporal.namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
    activities,
  });
  running = worker.run();
});

afterAll(async () => {
  worker.shutdown();
  await running;
  await client.connection.close();
  await temporal.stop();
});

describe('tenant workflows', () => {
  it('runs activities in the workflow tenant with the same idempotency key across retries', async () => {
    const handle = await startTenantWorkflow(client, postingWorkflow, {
      tenantId: tenantA,
      businessId: 'payment-1',
      taskQueue: TASK_QUEUE,
      args: ['10.00'],
    });
    const result = await handle.result();
    expect(handle.workflowId).toBe(`${tenantA}:postingWorkflow:payment-1`);
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(new Set(attempts.map((attempt) => attempt.tenantId))).toEqual(new Set([tenantA]));
    expect(new Set(attempts.map((attempt) => attempt.key)).size).toBe(1);
    expect(result).toBe(`10.00:${attempts[0]?.key ?? ''}`);
  });

  it('makes workflows searchable by tenantId', async () => {
    const deadline = Date.now() + 30_000;
    let found: string[] = [];
    while (Date.now() < deadline) {
      found = [];
      for await (const execution of client.workflow.list({ query: `tenantId = "${tenantA}"` })) {
        found.push(execution.workflowId);
      }
      if (found.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(found).toContain(`${tenantA}:postingWorkflow:payment-1`);
  });
});
