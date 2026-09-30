import { proxyActivities } from '@temporalio/workflow';
import type { TestActivities } from './activity-types.js';

const { record } = proxyActivities<TestActivities>({
  startToCloseTimeout: '10 seconds',
  retry: { initialInterval: '100 milliseconds', maximumAttempts: 3 },
});

export async function postingWorkflow(amount: string): Promise<string> {
  return record(amount);
}
