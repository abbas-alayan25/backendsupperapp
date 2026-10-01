import 'reflect-metadata';
import { runService } from '@super-app/nest';
import { AppModule, PLATFORM_PATH_PREFIXES } from './app.module.js';
import { loadConfig } from './config.js';
import { createDependencies } from './dependencies.js';
import { TenantGrpcService } from './grpc/tenant.grpc.js';

const dependencies = createDependencies(loadConfig());

await runService({
  name: 'tenant-service',
  module: AppModule.forRoot(dependencies),
  platformPathPrefixes: PLATFORM_PATH_PREFIXES,
  grpcServices: (app) => [app.get(TenantGrpcService).binding()],
});
