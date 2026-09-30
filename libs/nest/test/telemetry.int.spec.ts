import { createServer } from 'node:net';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { runWithContext } from '@super-app/common';
import { afterAll, describe, expect, it } from 'vitest';
import { TenantSpanProcessor, startTelemetry } from '../src/index.js';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('no port'));
        }
      });
    });
  });
}

async function fetchWithRetry(url: string): Promise<Response | undefined> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return undefined;
}

describe('telemetry', () => {
  const shutdowns: (() => Promise<void>)[] = [];

  afterAll(async () => {
    await Promise.all(shutdowns.map((shutdown) => shutdown()));
  });

  it('serves Prometheus metrics on the configured port', async () => {
    const port = await freePort();
    const telemetry = startTelemetry({
      serviceName: 'fixture',
      userIdHashKey: 'k',
      metricsPort: port,
    });
    shutdowns.push(() => telemetry.shutdown());
    const response = await fetchWithRetry(`http://127.0.0.1:${String(port)}/metrics`);
    expect(response?.status).toBe(200);
  });

  it('stamps tenant, request and hashed user ids on spans inside a request context', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new TenantSpanProcessor('k'), new SimpleSpanProcessor(exporter)],
    });
    shutdowns.push(() => provider.shutdown());
    const tracer = provider.getTracer('test');
    runWithContext({ tenantId: 't1', requestId: 'r1', locale: 'en', userId: 'u1' }, () => {
      tracer.startSpan('inside').end();
    });
    tracer.startSpan('outside').end();
    const [inside, outside] = exporter.getFinishedSpans();
    expect(inside?.attributes).toMatchObject({ tenant_id: 't1', request_id: 'r1' });
    expect(inside?.attributes.user_id).toMatch(/^[0-9a-f]{32}$/);
    expect(outside?.attributes).not.toHaveProperty('tenant_id');
  });
});
