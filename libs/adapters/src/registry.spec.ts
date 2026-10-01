import { AppError } from '@super-app/common';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATOR_PROVIDERS, registerSimulators } from './catalog.js';
import {
  type AdapterRecord,
  AdapterRegistry,
  type AdapterSource,
  type SecretSource,
} from './registry.js';
import { BankSimulator } from './simulators/bank.simulator.js';
import { type PartnerType, adapterSecretPath } from './types.js';

const TENANT_A = '0192f5a0-0000-7000-8000-00000000000a';
const TENANT_B = '0192f5a0-0000-7000-8000-00000000000b';

class FakeSource implements AdapterSource {
  calls = 0;
  constructor(private readonly records: Record<string, AdapterRecord[]>) {}
  listAdapters(tenantId: string, partnerType: PartnerType): Promise<AdapterRecord[]> {
    this.calls += 1;
    return Promise.resolve(this.records[`${tenantId}:${partnerType}`] ?? []);
  }
}

class FakeSecrets implements SecretSource {
  readonly reads: string[] = [];
  readKv(path: string): Promise<Record<string, string> | undefined> {
    this.reads.push(path);
    return Promise.resolve(
      path.includes('missing') ? undefined : { webhookSecret: `secret-for-${path}` },
    );
  }
}

function record(
  tenantId: string,
  partnerType: PartnerType,
  provider: string,
  priority: number,
): AdapterRecord {
  return {
    partnerType,
    provider,
    priority,
    config: {},
    secretRef: adapterSecretPath(tenantId, partnerType, provider),
  };
}

function setup(records: Record<string, AdapterRecord[]>, now: () => number = Date.now) {
  const source = new FakeSource(records);
  const secrets = new FakeSecrets();
  const registry = registerSimulators(new AdapterRegistry(source, secrets, 1_000, now));
  return { source, secrets, registry };
}

describe('AdapterRegistry', () => {
  it('lists every registered simulator in the catalog with a config schema', () => {
    const { registry } = setup({});
    const catalog = registry.catalog();
    const expected = Object.values(DEFAULT_SIMULATOR_PROVIDERS).reduce(
      (total, names) => total + names.length,
      0,
    );
    expect(catalog).toHaveLength(expected);
    expect(catalog.find((entry) => entry.provider === 'bank-sim-a')).toMatchObject({
      partnerType: 'BANK',
    });
    expect(catalog.every((entry) => entry.configSchema.type === 'object')).toBe(true);
  });

  it('rejects duplicate registrations', () => {
    const { registry } = setup({});
    expect(() =>
      registry.register({
        partnerType: 'BANK',
        provider: 'bank-sim-a',
        description: 'dup',
        configSchema: {},
        create: (context) => new BankSimulator(context),
      }),
    ).toThrow(RangeError);
  });

  it('resolves adapters in priority order per tenant', async () => {
    const { registry } = setup({
      [`${TENANT_A}:BANK`]: [
        record(TENANT_A, 'BANK', 'bank-sim-b', 2),
        record(TENANT_A, 'BANK', 'bank-sim-a', 1),
      ],
      [`${TENANT_B}:BANK`]: [record(TENANT_B, 'BANK', 'bank-sim-c', 1)],
    });
    const banksA = await registry.resolveAll(TENANT_A, 'BANK');
    expect(banksA).toHaveLength(2);
    const primaryA = await registry.resolve(TENANT_A, 'BANK');
    expect(primaryA).toBe(banksA[0]);
    const primaryB = await registry.resolve(TENANT_B, 'BANK');
    expect(primaryB).not.toBe(primaryA);
  });

  it('loads secrets only from the tenant-scoped Vault path', async () => {
    const { registry, secrets } = setup({
      [`${TENANT_A}:KYC`]: [record(TENANT_A, 'KYC', 'kyc-sim', 1)],
    });
    await registry.resolve(TENANT_A, 'KYC');
    expect(secrets.reads).toEqual([`tenants/${TENANT_A}/adapters/kyc/kyc-sim`]);
  });

  it("refuses a record that points at another tenant's secrets", async () => {
    const { registry } = setup({
      [`${TENANT_A}:KYC`]: [{ ...record(TENANT_B, 'KYC', 'kyc-sim', 1) }],
    });
    await expect(registry.resolve(TENANT_A, 'KYC')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: { reason: 'SECRET_PATH_NOT_TENANT_SCOPED' },
    });
  });

  it('fails with SERVICE_DISABLED when the tenant has no adapter for the partner type', async () => {
    const { registry } = setup({});
    const error = await registry.resolve(TENANT_A, 'ACQUIRER').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('SERVICE_DISABLED');
  });

  it('fails with PARTNER_UNAVAILABLE for unknown providers and missing secrets', async () => {
    const { registry } = setup({
      [`${TENANT_A}:BANK`]: [record(TENANT_A, 'BANK', 'real-bank', 1)],
      [`${TENANT_A}:SMS`]: [
        {
          ...record(TENANT_A, 'SMS', 'sms-sim', 1),
          secretRef: `tenants/${TENANT_A}/adapters/sms/missing`,
        },
      ],
    });
    await expect(registry.resolve(TENANT_A, 'BANK')).rejects.toMatchObject({
      code: 'PARTNER_UNAVAILABLE',
    });
    await expect(registry.resolve(TENANT_A, 'SMS')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('caches instances until they expire or the tenant is invalidated', async () => {
    let now = 0;
    const { registry, secrets } = setup(
      { [`${TENANT_A}:BANK`]: [record(TENANT_A, 'BANK', 'bank-sim-a', 1)] },
      () => now,
    );
    const first = await registry.resolve(TENANT_A, 'BANK');
    expect(await registry.resolve(TENANT_A, 'BANK')).toBe(first);
    registry.invalidate(TENANT_A);
    const second = await registry.resolve(TENANT_A, 'BANK');
    expect(second).not.toBe(first);
    now = 2_000;
    expect(await registry.resolve(TENANT_A, 'BANK')).not.toBe(second);
    expect(secrets.reads).toHaveLength(3);
  });
});
