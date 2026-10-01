import type { IEntryNestModule } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@super-app/common';
import {
  GRPC_PORT,
  type GrpcHealthServer,
  type GrpcServiceBinding,
  startGrpcHealthServer,
} from '../grpc/grpc-health-server.js';
import { METRICS_PORT, startTelemetry } from '../observability/telemetry.js';
import { HTTP_PORT, createServiceApp, listen } from './create-service-app.js';

const LOCAL_LOG_HASH_KEY = 'local-development-log-hash-key';

export interface RunServiceOptions {
  name: string;
  module: IEntryNestModule;
  env?: NodeJS.ProcessEnv;
  platformPathPrefixes?: readonly string[];
  grpcServices?: (app: NestFastifyApplication) => readonly GrpcServiceBinding[];
}

export interface ServicePorts {
  http: number;
  grpc: number;
  metrics: number;
}

export interface RunningService {
  readonly app: NestFastifyApplication;
  readonly grpc: GrpcHealthServer;
  readonly ports: ServicePorts;
  shutdown(): Promise<void>;
}

export function portFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(`Invalid port ${value}`);
  }
  return port;
}

export function logHashKeyFromEnv(env: NodeJS.ProcessEnv): string {
  const key = env.LOG_USER_ID_HASH_KEY;
  if (key) {
    return key;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('LOG_USER_ID_HASH_KEY is required in production');
  }
  return LOCAL_LOG_HASH_KEY;
}

export async function runService(options: RunServiceOptions): Promise<RunningService> {
  const env = options.env ?? process.env;
  const userIdHashKey = logHashKeyFromEnv(env);
  const ports: ServicePorts = {
    http: portFromEnv(env.PORT, HTTP_PORT),
    grpc: portFromEnv(env.GRPC_PORT, GRPC_PORT),
    metrics: portFromEnv(env.METRICS_PORT, METRICS_PORT),
  };
  const logger = createLogger({ service: options.name, userIdHashKey, level: env.LOG_LEVEL });
  const telemetry = startTelemetry({
    serviceName: options.name,
    userIdHashKey,
    metricsPort: ports.metrics,
    traceEndpoint: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  });
  const app = await createServiceApp(options.module, {
    logger,
    platformPathPrefixes: options.platformPathPrefixes ?? [],
  });
  await listen(app, ports.http);
  const grpc = await startGrpcHealthServer({
    port: ports.grpc,
    services: options.grpcServices?.(app) ?? [],
  });
  let stopping: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    stopping ??= (async () => {
      logger.info('shutting down');
      await grpc.shutdown();
      await app.close();
      await telemetry.shutdown();
    })();
    return stopping;
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown().then(() => process.exit(0));
    });
  }
  logger.info({ ports }, 'service started');
  return { app, grpc, ports: { ...ports, grpc: grpc.port }, shutdown };
}
