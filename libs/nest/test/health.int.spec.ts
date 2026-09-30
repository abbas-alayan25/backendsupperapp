import 'reflect-metadata';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@super-app/common';
import { protoPath } from 'grpc-health-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type GrpcHealthServer,
  HealthModule,
  type ReadinessCheck,
  createServiceApp,
  startGrpcHealthServer,
} from '../src/index.js';

interface HealthCheckResponse {
  status: string;
}

interface HealthClient {
  check(
    request: { service: string },
    callback: (error: Error | null, response?: HealthCheckResponse) => void,
  ): void;
  close(): void;
}

type HealthClientConstructor = new (
  address: string,
  channelCredentials: ReturnType<typeof credentials.createInsecure>,
) => HealthClient;

function healthClient(port: number): HealthClient {
  const definition = loadPackageDefinition(loadSync(protoPath, { enums: String })) as unknown as {
    grpc: { health: { v1: { Health: HealthClientConstructor } } };
  };
  return new definition.grpc.health.v1.Health(
    `127.0.0.1:${String(port)}`,
    credentials.createInsecure(),
  );
}

function check(client: HealthClient, service = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    client.check({ service }, (error, response) => {
      if (error) {
        reject(error);
      } else {
        resolve(response?.status ?? 'UNKNOWN');
      }
    });
  });
}

const logger = createLogger({ service: 'health-test', userIdHashKey: 'k', level: 'silent' });

async function appWith(checks: ReadinessCheck[]): Promise<NestFastifyApplication> {
  @Module({ imports: [HealthModule.forRoot(checks)] })
  class TestModule {}
  const app = await createServiceApp(TestModule, { logger });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('health endpoints', () => {
  let healthy: NestFastifyApplication;
  let unhealthy: NestFastifyApplication;

  beforeAll(async () => {
    healthy = await appWith([{ name: 'db', check: () => Promise.resolve() }]);
    unhealthy = await appWith([
      { name: 'db', check: () => Promise.resolve() },
      { name: 'kafka', check: () => Promise.reject(new Error('down')) },
    ]);
  });

  afterAll(async () => {
    await healthy.close();
    await unhealthy.close();
  });

  it('answers /health without a tenant header', async () => {
    const response = await healthy.getHttpAdapter().getInstance().inject({ url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('answers /ready with each check when ready', async () => {
    const response = await healthy.getHttpAdapter().getInstance().inject({ url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { db: 'ok' } });
  });

  it('returns 503 from /ready when a check fails but stays live', async () => {
    const instance = unhealthy.getHttpAdapter().getInstance();
    const ready = await instance.inject({ url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'unavailable', checks: { db: 'ok', kafka: 'failed' } });
    expect((await instance.inject({ url: '/health' })).statusCode).toBe(200);
  });

  it('still requires a tenant on other routes', async () => {
    const response = await healthy.getHttpAdapter().getInstance().inject({ url: '/other' });
    expect(response.statusCode).toBe(403);
  });
});

describe('gRPC health server', () => {
  let server: GrpcHealthServer;
  let client: HealthClient;

  beforeAll(async () => {
    server = await startGrpcHealthServer({ port: 0, host: '127.0.0.1' });
    client = healthClient(server.port);
  });

  afterAll(async () => {
    client.close();
    await server.shutdown();
  });

  it('reports SERVING', async () => {
    expect(await check(client)).toBe('SERVING');
  });

  it('reports status changes', async () => {
    server.setStatus('NOT_SERVING');
    expect(await check(client)).toBe('NOT_SERVING');
    server.setStatus('SERVING');
    expect(await check(client)).toBe('SERVING');
  });
});
