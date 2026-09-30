import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker, type WorkerOptions } from '@temporalio/worker';
import { tenantActivityInterceptors } from './activity.js';

export function workflowInterceptorModulePath(): string {
  const compiled = fileURLToPath(new URL('./workflow-interceptors.js', import.meta.url));
  return existsSync(compiled)
    ? compiled
    : fileURLToPath(new URL('./workflow-interceptors.ts', import.meta.url));
}

export interface TenantWorkerOptions {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
  readonly workflowsPath: string;
  readonly activities: WorkerOptions['activities'];
}

export async function createTenantWorker(options: TenantWorkerOptions): Promise<Worker> {
  const connection = await NativeConnection.connect({ address: options.address });
  return Worker.create({
    connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    workflowsPath: options.workflowsPath,
    activities: options.activities,
    interceptors: {
      workflowModules: [workflowInterceptorModulePath()],
      activity: [tenantActivityInterceptors],
    },
  });
}
