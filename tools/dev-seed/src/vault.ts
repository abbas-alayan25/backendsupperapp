import { randomBytes } from 'node:crypto';
import {
  DEMO_TENANTS,
  type DemoTenant,
  adapterSecretPath,
  tenantTransitKey,
} from './demo-tenants.ts';

export interface VaultConnection {
  readonly address: string;
  readonly token: string;
}

export interface SeedReport {
  transitEnabled: boolean;
  keysCreated: string[];
  secretsWritten: string[];
  secretsKept: string[];
}

export const API_KEY_PEPPER_PATH = 'platform/api-key-pepper';

async function vault(connection: VaultConnection, method: string, path: string, body?: unknown) {
  const response = await fetch(`${connection.address}/v1/${path}`, {
    method,
    headers: { 'X-Vault-Token': connection.token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Vault ${method} ${path} failed with ${String(response.status)}: ${await response.text()}`,
    );
  }
  return response;
}

async function exists(connection: VaultConnection, path: string): Promise<boolean> {
  const response = await vault(connection, 'GET', path);
  return response.status !== 404;
}

async function writeOnce(
  connection: VaultConnection,
  kvPath: string,
  data: Record<string, string>,
  report: SeedReport,
): Promise<void> {
  if (await exists(connection, `secret/data/${kvPath}`)) {
    report.secretsKept.push(kvPath);
    return;
  }
  await vault(connection, 'POST', `secret/data/${kvPath}`, { data });
  report.secretsWritten.push(kvPath);
}

export async function seedVault(
  connection: VaultConnection,
  tenants: readonly DemoTenant[] = DEMO_TENANTS,
): Promise<SeedReport> {
  const report: SeedReport = {
    transitEnabled: false,
    keysCreated: [],
    secretsWritten: [],
    secretsKept: [],
  };
  const mounts = (await (await vault(connection, 'GET', 'sys/mounts')).json()) as Record<
    string,
    unknown
  >;
  if (!('transit/' in mounts)) {
    await vault(connection, 'POST', 'sys/mounts/transit', { type: 'transit' });
    report.transitEnabled = true;
  }
  await writeOnce(
    connection,
    API_KEY_PEPPER_PATH,
    { pepper: randomBytes(32).toString('hex') },
    report,
  );
  for (const tenant of tenants) {
    const key = tenantTransitKey(tenant.id);
    if (!(await exists(connection, `transit/keys/${key}`))) {
      await vault(connection, 'POST', `transit/keys/${key}`, { type: 'aes256-gcm96' });
      report.keysCreated.push(key);
    }
    for (const adapter of tenant.adapters) {
      await writeOnce(
        connection,
        adapterSecretPath(tenant.id, adapter),
        {
          mode: 'simulator',
          apiKey: `sim_${randomBytes(16).toString('hex')}`,
          webhookSecret: randomBytes(32).toString('hex'),
        },
        report,
      );
    }
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const report = await seedVault({
    address: process.env.VAULT_ADDR ?? 'http://127.0.0.1:8200',
    token: process.env.VAULT_TOKEN ?? 'superapp-dev-root',
  });
  console.log(
    `Vault seeded: transit ${report.transitEnabled ? 'enabled' : 'already enabled'}, ${String(report.keysCreated.length)} keys created, ${String(report.secretsWritten.length)} secrets written, ${String(report.secretsKept.length)} kept`,
  );
}
