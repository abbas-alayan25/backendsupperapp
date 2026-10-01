import { Inject, Injectable } from '@nestjs/common';
import {
  type AdapterRegistry,
  type CatalogEntry,
  type PartnerType,
  type ProbeResult,
  adapterSecretPath,
} from '@super-app/adapters';
import { AppError, newId } from '@super-app/common';
import type { Redis } from 'ioredis';
import { tenancyEvent } from '../events/tenancy-events.js';
import type { TenantAdapter } from '../gen/prisma/client.js';
import { invalidateTenantCaches } from '../shared/cache.js';
import { outbox } from '../shared/outbox.js';
import { type TenancyDb, type Tx, asJson, conflictOnDuplicate } from '../shared/tenancy-db.js';
import { ADAPTER_REGISTRY, REDIS, TENANCY_DB } from '../shared/tokens.js';
import { compileSchema } from '../shared/validation.js';

export interface AdapterView {
  readonly id: string;
  readonly partnerType: string;
  readonly provider: string;
  readonly priority: number;
  readonly config: unknown;
  readonly secretRef: string;
  readonly status: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface CreateAdapterInput {
  readonly partnerType: PartnerType;
  readonly provider: string;
  readonly priority: number;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface UpdateAdapterInput {
  readonly priority?: number;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly status?: 'ACTIVE' | 'DISABLED';
  readonly version?: number;
}

export function adapterView(adapter: TenantAdapter): AdapterView {
  return {
    id: adapter.id,
    partnerType: adapter.partnerType,
    provider: adapter.provider,
    priority: adapter.priority,
    config: adapter.config,
    secretRef: adapter.secretRef,
    status: adapter.status,
    version: adapter.version,
    updatedAt: adapter.updatedAt.toISOString(),
  };
}

@Injectable()
export class AdaptersService {
  constructor(
    @Inject(TENANCY_DB) private readonly db: TenancyDb,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
  ) {}

  catalog(): CatalogEntry[] {
    return this.registry.catalog();
  }

  async list(tenantId: string): Promise<AdapterView[]> {
    const adapters = await this.db.read(tenantId, (tx) =>
      tx.tenantAdapter.findMany({ where: { tenantId }, orderBy: [{ partnerType: 'asc' }, { priority: 'asc' }] }),
    );
    return adapters.map(adapterView);
  }

  async create(tenantId: string, input: CreateAdapterInput): Promise<AdapterView> {
    const config = input.config ?? {};
    this.validateConfig(input.partnerType, input.provider, config);
    const adapter = await conflictOnDuplicate(
      this.db.write(tenantId, async (tx) => {
        await this.requireTenant(tx, tenantId);
        const created = await tx.tenantAdapter.create({
          data: {
            id: newId(),
            tenantId,
            partnerType: input.partnerType,
            provider: input.provider,
            priority: input.priority,
            config: asJson(config),
            secretRef: adapterSecretPath(tenantId, input.partnerType, input.provider),
            status: 'ACTIVE',
          },
        });
        await this.announce(tx, tenantId, created);
        return created;
      }),
      { field: 'provider' },
    );
    await this.afterChange(tenantId);
    return adapterView(adapter);
  }

  async update(tenantId: string, adapterId: string, input: UpdateAdapterInput): Promise<AdapterView> {
    const adapter = await this.db.write(tenantId, async (tx) => {
      const current = await this.find(tx, tenantId, adapterId);
      if (input.version !== undefined && input.version !== current.version) {
        throw new AppError('CONFLICT', { reason: 'VERSION_MISMATCH', currentVersion: current.version });
      }
      if (input.config !== undefined) {
        this.validateConfig(current.partnerType as PartnerType, current.provider, input.config);
      }
      const updated = await tx.tenantAdapter.update({
        where: { id: current.id },
        data: {
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.config === undefined ? {} : { config: asJson(input.config) }),
          ...(input.status === undefined ? {} : { status: input.status }),
          version: { increment: 1 },
        },
      });
      await this.announce(tx, tenantId, updated);
      return updated;
    });
    await this.afterChange(tenantId);
    return adapterView(adapter);
  }

  async disable(tenantId: string, adapterId: string): Promise<AdapterView> {
    return this.update(tenantId, adapterId, { status: 'DISABLED' });
  }

  async test(tenantId: string, adapterId: string): Promise<ProbeResult & { readonly adapterId: string }> {
    const adapter = await this.db.read(tenantId, (tx) => this.find(tx, tenantId, adapterId));
    try {
      const instance = await this.registry.build(tenantId, {
        partnerType: adapter.partnerType as PartnerType,
        provider: adapter.provider,
        priority: adapter.priority,
        config: adapter.config as Readonly<Record<string, unknown>>,
        secretRef: adapter.secretRef,
      });
      return { adapterId, ...(await instance.probe()) };
    } catch (error) {
      if (error instanceof AppError) {
        return { adapterId, ok: false, latencyMs: 0, detail: error.code };
      }
      throw error;
    }
  }

  private validateConfig(partnerType: PartnerType, provider: string, config: Readonly<Record<string, unknown>>): void {
    const entry = this.registry.catalog().find((item) => item.partnerType === partnerType && item.provider === provider);
    if (!entry) {
      throw new AppError('VALIDATION_FAILED', { field: 'provider', reason: 'UNKNOWN_PROVIDER', partnerType, provider });
    }
    const validate = compileSchema(entry.configSchema);
    if (!validate(config)) {
      throw new AppError('VALIDATION_FAILED', {
        field: 'config',
        issues: (validate.errors ?? []).map((error) => ({ path: error.instancePath || '/', message: error.message ?? 'invalid' })),
      });
    }
  }

  private async requireTenant(tx: Tx, tenantId: string): Promise<void> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new AppError('NOT_FOUND', { resource: 'tenant' });
    }
  }

  private async find(tx: Tx, tenantId: string, adapterId: string): Promise<TenantAdapter> {
    const adapter = await tx.tenantAdapter.findFirst({ where: { id: adapterId, tenantId } });
    if (!adapter) {
      throw new AppError('NOT_FOUND', { resource: 'tenant_adapter' });
    }
    return adapter;
  }

  private async announce(tx: Tx, tenantId: string, adapter: TenantAdapter): Promise<void> {
    await outbox.writePrisma(
      tx,
      tenancyEvent('tenant.adapter_changed', tenantId, adapter.id, {
        adapterId: adapter.id,
        partnerType: adapter.partnerType,
        provider: adapter.provider,
        priority: adapter.priority,
        status: adapter.status,
      }),
    );
  }

  private async afterChange(tenantId: string): Promise<void> {
    this.registry.invalidate(tenantId);
    await invalidateTenantCaches(this.redis, tenantId);
  }
}
