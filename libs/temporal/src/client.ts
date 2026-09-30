import { isUuid } from '@super-app/common';
import {
  Client,
  Connection,
  type WorkflowHandle,
  type WorkflowStartOptions,
} from '@temporalio/client';
import type { Workflow } from '@temporalio/common';
import { TENANT_ID_SEARCH_ATTRIBUTE } from './search-attributes.js';

export interface TemporalConnectionOptions {
  readonly address: string;
  readonly namespace: string;
}

export async function createTemporalClient(options: TemporalConnectionOptions): Promise<Client> {
  const connection = await Connection.connect({ address: options.address });
  return new Client({ connection, namespace: options.namespace });
}

export function tenantWorkflowId(
  tenantId: string,
  workflowType: string,
  businessId: string,
): string {
  if (!isUuid(tenantId)) {
    throw new RangeError(`Invalid tenant id ${tenantId}`);
  }
  return `${tenantId}:${workflowType}:${businessId}`;
}

export interface StartTenantWorkflowOptions<W extends Workflow> {
  readonly tenantId: string;
  readonly businessId: string;
  readonly taskQueue: string;
  readonly args: Parameters<W>;
}

export function startTenantWorkflow<W extends Workflow>(
  client: Client,
  workflow: W,
  options: StartTenantWorkflowOptions<W>,
): Promise<WorkflowHandle<W>> {
  const workflowId = tenantWorkflowId(options.tenantId, workflow.name, options.businessId);
  const startOptions = {
    workflowId,
    taskQueue: options.taskQueue,
    args: options.args,
    typedSearchAttributes: [{ key: TENANT_ID_SEARCH_ATTRIBUTE, value: options.tenantId }],
  } as unknown as WorkflowStartOptions<W>;
  return client.workflow.start(workflow, startOptions);
}
