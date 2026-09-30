import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { protoPath } from 'grpc-health-check';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BASE_PORT = 41_000;

interface ServiceProject {
  name: string;
  root: string;
  language: 'ts' | 'go';
}

interface ProjectJson {
  name: string;
  tags?: string[];
}

function findServiceProjects(dir: string, found: ServiceProject[] = []): ServiceProject[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      findServiceProjects(path, found);
    } else if (entry === 'project.json') {
      const project = JSON.parse(readFileSync(path, 'utf8')) as ProjectJson;
      const tags = project.tags ?? [];
      if (tags.includes('type:service')) {
        found.push({
          name: project.name,
          root: dir,
          language: tags.includes('lang:go') ? 'go' : 'ts',
        });
      }
    }
  }
  return found;
}

interface HealthClient {
  check(
    request: { service: string },
    options: { deadline: Date },
    callback: (error: Error | null, response?: { status: string }) => void,
  ): void;
  close(): void;
}

type HealthClientConstructor = new (
  address: string,
  channelCredentials: ReturnType<typeof credentials.createInsecure>,
) => HealthClient;

const HealthClientCtor = (
  loadPackageDefinition(loadSync(protoPath, { enums: String })) as unknown as {
    grpc: { health: { v1: { Health: HealthClientConstructor } } };
  }
).grpc.health.v1.Health;

function grpcStatus(port: number): Promise<string> {
  const client = new HealthClientCtor(`127.0.0.1:${String(port)}`, credentials.createInsecure());
  return new Promise<string>((resolve, reject) => {
    client.check({ service: '' }, { deadline: new Date(Date.now() + 5_000) }, (error, response) => {
      client.close();
      if (error) {
        reject(error);
      } else {
        resolve(response?.status ?? 'UNKNOWN');
      }
    });
  });
}

async function waitForHealth(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`process exited with ${String(child.exitCode)} before becoming healthy`);
    }
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`timed out waiting for ${url}`);
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error('process did not exit after SIGTERM'));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

const services = findServiceProjects(join(ROOT, 'apps')).sort((a, b) =>
  a.name.localeCompare(b.name),
);
const running: ChildProcess[] = [];

afterAll(() => {
  for (const child of running) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

describe('service smoke', () => {
  it('finds every service project', () => {
    expect(services.length).toBe(23);
  });

  describe.each(services.map((service, index) => ({ ...service, index })))(
    '$name',
    ({ name, root, language, index }) => {
      it('boots, answers on HTTP, gRPC and metrics, and shuts down cleanly', async () => {
        const http = BASE_PORT + index * 3;
        const grpc = http + 1;
        const metrics = http + 2;
        const executable =
          language === 'ts' ? join(root, 'dist', 'main.js') : join(root, 'dist', name);
        expect(existsSync(executable), `${relative(ROOT, executable)} is built`).toBe(true);
        const child = spawn(
          language === 'ts' ? process.execPath : executable,
          language === 'ts' ? [executable] : [],
          {
            cwd: root,
            env: {
              ...process.env,
              PORT: String(http),
              GRPC_PORT: String(grpc),
              METRICS_PORT: String(metrics),
              LOG_LEVEL: 'warn',
              NODE_ENV: 'development',
            },
            stdio: ['ignore', 'ignore', 'inherit'],
          },
        );
        running.push(child);

        await waitForHealth(`http://127.0.0.1:${String(http)}/health`, child, 30_000);
        const ready = await fetch(`http://127.0.0.1:${String(http)}/ready`);
        expect(ready.status).toBe(200);
        const metricsResponse = await fetch(`http://127.0.0.1:${String(metrics)}/metrics`);
        expect(metricsResponse.status).toBe(200);
        expect(await grpcStatus(grpc)).toBe('SERVING');

        child.kill('SIGTERM');
        expect(await waitForExit(child, 15_000)).toBe(0);
      });
    },
  );
});
