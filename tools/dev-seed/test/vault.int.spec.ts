import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TENANTS, adapterSecretPath, tenantTransitKey } from '../src/demo-tenants.ts';
import { API_KEY_PEPPER_PATH, seedVault } from '../src/vault.ts';

const TOKEN = 'test-root';
let container: StartedTestContainer;
let address: string;

beforeAll(async () => {
  container = await new GenericContainer('hashicorp/vault:2.1.1')
    .withCommand(['server', '-dev', '-dev-listen-address=0.0.0.0:8200'])
    .withEnvironment({ VAULT_DEV_ROOT_TOKEN_ID: TOKEN })
    .withAddedCapabilities('IPC_LOCK')
    .withExposedPorts(8200)
    .withWaitStrategy(Wait.forHttp('/v1/sys/health', 8200).forStatusCode(200))
    .start();
  address = `http://${container.getHost()}:${String(container.getMappedPort(8200))}`;
});

afterAll(async () => {
  await container.stop();
});

const read = async (path: string) => {
  const response = await fetch(`${address}/v1/${path}`, { headers: { 'X-Vault-Token': TOKEN } });
  return {
    status: response.status,
    body:
      response.status === 200
        ? ((await response.json()) as { data: Record<string, unknown> })
        : undefined,
  };
};

describe('vault seed', () => {
  it('enables transit, creates one key per tenant and writes adapter secrets per tenant path', async () => {
    const report = await seedVault({ address, token: TOKEN });
    expect(report.transitEnabled).toBe(true);
    expect(report.keysCreated.sort()).toEqual(
      DEMO_TENANTS.map((tenant) => tenantTransitKey(tenant.id)).sort(),
    );
    const expectedPaths = DEMO_TENANTS.flatMap((tenant) =>
      tenant.adapters.map((adapter) => adapterSecretPath(tenant.id, adapter)),
    );
    expect(report.secretsWritten.sort()).toEqual([API_KEY_PEPPER_PATH, ...expectedPaths].sort());
    for (const tenant of DEMO_TENANTS) {
      expect((await read(`transit/keys/${tenantTransitKey(tenant.id)}`)).status).toBe(200);
      for (const adapter of tenant.adapters) {
        const secret = await read(`secret/data/${adapterSecretPath(tenant.id, adapter)}`);
        expect(secret.body?.data.data).toMatchObject({ mode: 'simulator' });
      }
    }
    expect(
      adapterSecretPath(DEMO_TENANTS[0]?.id ?? '', {
        partnerType: 'card-issuer',
        provider: 'card-sim',
      }),
    ).toBe(`tenants/${DEMO_TENANTS[0]?.id ?? ''}/adapters/card-issuer/card-sim`);
  });

  it('is idempotent and keeps existing secrets', async () => {
    const first = await read(
      `secret/data/${adapterSecretPath(DEMO_TENANTS[0]?.id ?? '', { partnerType: 'bank', provider: 'bank-sim-a' })}`,
    );
    const report = await seedVault({ address, token: TOKEN });
    expect(report).toMatchObject({ transitEnabled: false, keysCreated: [], secretsWritten: [] });
    const second = await read(
      `secret/data/${adapterSecretPath(DEMO_TENANTS[0]?.id ?? '', { partnerType: 'bank', provider: 'bank-sim-a' })}`,
    );
    expect(second.body?.data.data).toEqual(first.body?.data.data);
  });

  it('encrypts and decrypts with a tenant transit key and isolates tenants', async () => {
    const [a, b] = DEMO_TENANTS;
    const plaintext = Buffer.from('merchant-secret').toString('base64');
    const encrypt = await fetch(`${address}/v1/transit/encrypt/${tenantTransitKey(a?.id ?? '')}`, {
      method: 'POST',
      headers: { 'X-Vault-Token': TOKEN },
      body: JSON.stringify({ plaintext }),
    });
    const { data } = (await encrypt.json()) as { data: { ciphertext: string } };
    const decryptWith = (tenantId: string) =>
      fetch(`${address}/v1/transit/decrypt/${tenantTransitKey(tenantId)}`, {
        method: 'POST',
        headers: { 'X-Vault-Token': TOKEN },
        body: JSON.stringify({ ciphertext: data.ciphertext }),
      });
    const own = (await (await decryptWith(a?.id ?? '')).json()) as { data: { plaintext: string } };
    expect(own.data.plaintext).toBe(plaintext);
    expect((await decryptWith(b?.id ?? '')).status).toBe(400);
  });
});
