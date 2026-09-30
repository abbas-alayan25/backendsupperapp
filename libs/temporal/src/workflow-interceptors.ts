import { defaultPayloadConverter } from '@temporalio/common';
import {
  type ActivityInput,
  type Next,
  type WorkflowInterceptorsFactory,
  type WorkflowOutboundCallsInterceptor,
  workflowInfo,
} from '@temporalio/workflow';
import { TENANT_ID_HEADER, TENANT_ID_SEARCH_ATTRIBUTE } from './search-attributes.js';

class TenantOutboundInterceptor implements WorkflowOutboundCallsInterceptor {
  scheduleActivity(
    input: ActivityInput,
    next: Next<WorkflowOutboundCallsInterceptor, 'scheduleActivity'>,
  ) {
    const tenantId = workflowInfo().typedSearchAttributes.get(TENANT_ID_SEARCH_ATTRIBUTE);
    if (!tenantId) {
      throw new Error('Workflow was started without a tenantId search attribute');
    }
    return next({
      ...input,
      headers: {
        ...input.headers,
        [TENANT_ID_HEADER]: defaultPayloadConverter.toPayload(tenantId),
      },
    });
  }
}

export const interceptors: WorkflowInterceptorsFactory = () => ({
  outbound: [new TenantOutboundInterceptor()],
});
