import { Server, ServerCredentials } from '@grpc/grpc-js';
import { VaultClient, currentContext } from '@super-app/common';
import {
  type KafkaClient,
  type Producer,
  createKafka,
  createProducer,
  ensureTopics,
} from '@super-app/kafka';
import { tenantV1, unary } from '@super-app/proto';
import {
  type KafkaFixture,
  type RedisFixture,
  type VaultFixture,
  startKafka,
  startRedis,
  startVault,
} from '@super-app/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdapterRegistry,
  BankSimulator,
  TenantDirectory,
  adapterSecretPath,
  partnerTypeFromProto,
  profileCacheKey,
  registerSimulators,
} from '../src/index.js';

const TENANT_A = '0192f5a0-0000-7000-8000-00000000000a';
const TENANT_B = '0192f5a0-0000-7000-8000-00000000000b';

interface StubAdapter {
  provider: string;
  priority: number;
  secretRef?: string;
}

const adapters = new Map<string, StubAdapter[]>();
let profileCalls = 0;

let vault: VaultFixture;
let redisFixture: RedisFixture;
let kafkaFixture: KafkaFixture;
let redis: Redis;
let kafka: KafkaClient;
let producer: Producer;
let server: Server;
let directory: TenantDirectory;
let registry: AdapterRegistry;

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('condition not met in time');
}

beforeAll(async () => {
  [vault, redisFixture, kafkaFixture] = await Promise.all([
    startVault(),
    startRedis(),
    startKafka(),
  ]);
  redis = new Redis(redisFixture.url);
  kafka = createKafka({ brokers: [kafkaFixture.bootstrapServers], clientId: 'adapters-int' });
  const admin = kafka.admin();
  await admin.connect();
  await ensureTopics(admin, ['tenancy.tenants'], { replicationFactor: 1, partitionsOverride: 1 });
  await admin.disconnect();
  producer = createProducer(kafka);
  await producer.connect();

  const vaultClient = new VaultClient({ address: vault.address, token: vault.token });
  for (const [tenantId, provider] of [
    [TENANT_A, 'bank-sim-a'],
    [TENANT_A, 'bank-sim-b'],
    [TENANT_B, 'bank-sim-c'],
  ] as const) {
    await vaultClient.writeKv(adapterSecretPath(tenantId, 'BANK', provider), {
      mode: 'simulator',
      apiKey: `api-${tenantId}-${provider}`,
      webhookSecret: `whsec-${tenantId}-${provider}`,
    });
  }

  adapters.set(`${TENANT_A}:BANK`, [
    { provider: 'bank-sim-b', priority: 2 },
    { provider: 'bank-sim-a', priority: 1 },
  ]);
  adapters.set(`${TENANT_B}:BANK`, [{ provider: 'bank-sim-c', priority: 1 }]);
  adapters.set(`${TENANT_B}:KYC`, [
    { provider: 'kyc-sim', priority: 1, secretRef: adapterSecretPath(TENANT_A, 'KYC', 'kyc-sim') },
  ]);

  server = new Server();
  server.addService(tenantV1.TenantServiceService, {
    getProfile: unary<tenantV1.GetProfileRequest, tenantV1.GetProfileResponse>(() => {
      profileCalls += 1;
      const tenantId = currentContext()?.tenantId ?? '';
      return Promise.resolve({
        tenant: {
          id: tenantId,
          code: tenantId === TENANT_A ? 'acme-lb' : 'petra-jo',
          legalName: 'Legal',
          displayName: 'Display',
          country: tenantId === TENANT_A ? 'LB' : 'JO',
          status: tenantV1.TenantStatus.TENANT_STATUS_ACTIVE,
          deploymentModel: tenantV1.DeploymentModel.DEPLOYMENT_MODEL_SHARED,
          region: 'me-central-1',
          currentProfileVersion: profileCalls,
        },
        profile: {
          profileVersion: profileCalls,
          brand: { appName: 'Demo' },
          market: { currencies: ['USD'] },
          compliance: {},
          products: {},
          feesRef: '',
        },
      });
    }),
    resolveAdapter: unary<tenantV1.ResolveAdapterRequest, tenantV1.ResolveAdapterResponse>(
      (request) => {
        const tenantId = currentContext()?.tenantId ?? '';
        const partnerType = partnerTypeFromProto(request.partnerType) ?? 'BANK';
        return Promise.resolve({
          adapters: (adapters.get(`${tenantId}:${partnerType}`) ?? []).map((adapter, index) => ({
            id: `adapter-${String(index)}`,
            partnerType: request.partnerType,
            provider: adapter.provider,
            priority: adapter.priority,
            config: { simulator: { mode: 'success' } },
            secretRef:
              adapter.secretRef ?? adapterSecretPath(tenantId, partnerType, adapter.provider),
          })),
        });
      },
    ),
    resolveDomain: unary<tenantV1.ResolveDomainRequest, tenantV1.ResolveDomainResponse>(() =>
      Promise.resolve({ tenantId: '', kind: 0, status: 0 }),
    ),
    listActiveTenants: unary<tenantV1.ListActiveTenantsRequest, tenantV1.ListActiveTenantsResponse>(
      () => Promise.resolve({ tenants: [] }),
    ),
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) => {
      if (error) reject(error);
      else resolve(bound);
    });
  });

  directory = new TenantDirectory({ address: `127.0.0.1:${String(port)}`, redis });
  registry = registerSimulators(new AdapterRegistry(directory, vaultClient));
  directory.onInvalidate((tenantId) => {
    registry.invalidate(tenantId);
  });
  await directory.startInvalidation(kafka, `adapters-int-${String(Date.now())}`);
}, 600_000);

afterAll(async () => {
  await directory.close();
  await producer.disconnect();
  server.forceShutdown();
  redis.disconnect();
  await Promise.all([vault.stop(), redisFixture.stop(), kafkaFixture.stop()]);
});

describe('adapter resolution with Vault and TenantService', () => {
  it('resolves each tenant its own adapters in priority order', async () => {
    const banksA = await registry.resolveAll(TENANT_A, 'BANK');
    expect(banksA.map((bank) => (bank as BankSimulator).constructor.name)).toEqual([
      'BankSimulator',
      'BankSimulator',
    ]);
    const primaryA = (await registry.resolve(TENANT_A, 'BANK')) as BankSimulator;
    const primaryB = (await registry.resolve(TENANT_B, 'BANK')) as BankSimulator;
    expect(primaryA).toBe(banksA[0]);
    expect(primaryA).not.toBe(primaryB);
  });

  it("loads secrets from the tenant's Vault path so webhooks only verify with that tenant's secret", async () => {
    const primaryA = (await registry.resolve(TENANT_A, 'BANK')) as BankSimulator;
    const primaryB = (await registry.resolve(TENANT_B, 'BANK')) as BankSimulator;
    const signedByA = primaryA.signWebhook([
      { partnerEventId: 'evt-1', kind: 'PAYOUT_RESULT', railRef: 'r', status: 'SETTLED' },
    ]);
    await expect(
      primaryA.handleWebhook(signedByA.payload, signedByA.signature),
    ).resolves.toHaveLength(1);
    await expect(
      primaryB.handleWebhook(signedByA.payload, signedByA.signature),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const reference = new BankSimulator({
      tenantId: TENANT_A,
      partnerType: 'BANK',
      provider: 'bank-sim-a',
      config: {},
      secrets: { webhookSecret: `whsec-${TENANT_A}-bank-sim-a` },
    });
    await expect(
      reference.handleWebhook(signedByA.payload, signedByA.signature),
    ).resolves.toHaveLength(1);
  });

  it("refuses an adapter record that points at another tenant's Vault path", async () => {
    await expect(registry.resolve(TENANT_B, 'KYC')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: { reason: 'SECRET_PATH_NOT_TENANT_SCOPED' },
    });
  });
});

describe('tenant directory cache', () => {
  it('caches profiles in Redis under the tenant key with a five minute TTL', async () => {
    const before = profileCalls;
    const first = await directory.getProfile(TENANT_A);
    const second = await directory.getProfile(TENANT_A);
    expect(profileCalls).toBe(before + 1);
    expect(second).toEqual(first);
    expect(first.tenant?.code).toBe('acme-lb');
    const ttl = await redis.ttl(profileCacheKey(TENANT_A));
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);
    expect(await redis.exists(profileCacheKey(TENANT_B))).toBe(0);
  });

  it('drops the cached profile and adapter instances when tenancy.tenants announces a change', async () => {
    await directory.getProfile(TENANT_A);
    await directory.getProfile(TENANT_B);
    const bankBefore = await registry.resolve(TENANT_A, 'BANK');
    const bankBBefore = await registry.resolve(TENANT_B, 'BANK');
    await producer.send({
      topic: 'tenancy.tenants',
      messages: [
        {
          key: `${TENANT_A}:${TENANT_A}`,
          value: Buffer.from('opaque'),
          headers: { tenantId: TENANT_A, type: 'tenant.profile_changed', eventId: 'evt-profile' },
        },
      ],
    });
    await waitFor(async () => (await redis.exists(profileCacheKey(TENANT_A))) === 0);
    expect(await redis.exists(profileCacheKey(TENANT_B))).toBe(1);
    expect(await registry.resolve(TENANT_A, 'BANK')).not.toBe(bankBefore);
    expect(await registry.resolve(TENANT_B, 'BANK')).toBe(bankBBefore);
    const refreshed = await directory.getProfile(TENANT_A);
    expect(refreshed.profile?.profileVersion).toBe(profileCalls);
  });
});
