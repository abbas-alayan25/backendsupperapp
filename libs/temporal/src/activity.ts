import { createHash } from 'node:crypto';
import { DEFAULT_LOCALE, isUuid, runWithContext } from '@super-app/common';
import { Context } from '@temporalio/activity';
import { defaultPayloadConverter } from '@temporalio/common';
import type {
  ActivityExecuteInput,
  ActivityInboundCallsInterceptor,
  ActivityInterceptorsFactory,
  Next,
} from '@temporalio/worker';
import { TENANT_ID_HEADER } from './search-attributes.js';

export interface ActivityIdentity {
  readonly workflowId: string;
  readonly runId: string;
  readonly activityId: string;
}

export class NotInWorkflowActivityError extends Error {
  constructor() {
    super('Activity is not running inside a workflow execution');
    this.name = 'NotInWorkflowActivityError';
  }
}

function currentActivityIdentity(): ActivityIdentity {
  const info = Context.current().info;
  const execution = info.workflowExecution;
  if (!execution) {
    throw new NotInWorkflowActivityError();
  }
  return { workflowId: execution.workflowId, runId: execution.runId, activityId: info.activityId };
}

export function activityIdempotencyKey(identity?: ActivityIdentity): string {
  const source = identity ?? currentActivityIdentity();
  const hex = createHash('sha256')
    .update(`${source.workflowId}/${source.runId}/${source.activityId}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

class TenantActivityInterceptor implements ActivityInboundCallsInterceptor {
  constructor(private readonly context: Context) {}

  execute(
    input: ActivityExecuteInput,
    next: Next<ActivityInboundCallsInterceptor, 'execute'>,
  ): Promise<unknown> {
    const payload = input.headers[TENANT_ID_HEADER];
    const tenantId = payload ? defaultPayloadConverter.fromPayload<string>(payload) : undefined;
    if (!tenantId || !isUuid(tenantId)) {
      throw new Error('Activity was scheduled without a tenant-id header');
    }
    return runWithContext(
      {
        tenantId,
        requestId: this.context.info.workflowExecution?.workflowId ?? this.context.info.activityId,
        locale: DEFAULT_LOCALE,
      },
      () => next(input),
    );
  }
}

export const tenantActivityInterceptors: ActivityInterceptorsFactory = (context) => ({
  inbound: new TenantActivityInterceptor(context),
});
