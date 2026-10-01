import { Inject, Injectable } from '@nestjs/common';
import { AppError, type TenantProfileDocument, currentContext, isUuid, newId } from '@super-app/common';
import type { Redis } from 'ioredis';
import { tenancyEvent } from '../events/tenancy-events.js';
import type { Tenant } from '../gen/prisma/client.js';
import { invalidateTenantCaches } from '../shared/cache.js';
import { outbox } from '../shared/outbox.js';
import { type TenancyDb, type Tx, asJson, conflictOnDuplicate } from '../shared/tenancy-db.js';
import { REDIS, TENANCY_DB } from '../shared/tokens.js';
import { lockTenant } from '../tenants/tenants.service.js';
import { type ProfileBlocks, composeDocument, desiredAdapters, splitDraftDocument } from './profile-document.js';
import { type ProfileView, profileView } from './profile-view.js';

export interface ActivationResult {
  readonly profile: ProfileView;
  readonly previousProfileVersion: number | null;
  readonly adaptersChanged: number;
}

function deploymentCluster(tenant: Tenant, model: string): string {
  return model === 'DEDICATED' ? `dedicated-${tenant.code}` : 'shared';
}

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(TENANCY_DB) private readonly db: TenancyDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async list(tenantId: string): Promise<ProfileView[]> {
    await this.requireTenant(tenantId);
    const profiles = await this.db.read(tenantId, (tx) =>
      tx.tenantProfile.findMany({ where: { tenantId }, orderBy: { profileVersion: 'desc' } }),
    );
    return profiles.map(profileView);
  }

  async createDraft(tenantId: string, document: unknown, feesRef?: string): Promise<ProfileView> {
    const blocks = splitDraftDocument(document);
    const profile = await conflictOnDuplicate(
      this.db.write(tenantId, async (tx) => {
        const tenant = await lockTenant(tx, tenantId);
        if (tenant.status === 'OFFBOARDED') {
          throw new AppError('CONFLICT', { reason: 'TENANT_OFFBOARDED' });
        }
        if (blocks.market.country !== tenant.country) {
          throw new AppError('VALIDATION_FAILED', { field: 'market.country', reason: 'COUNTRY_MISMATCH' });
        }
        const latest = await tx.tenantProfile.aggregate({ where: { tenantId }, _max: { profileVersion: true } });
        return tx.tenantProfile.create({
          data: {
            id: newId(),
            tenantId,
            profileVersion: (latest._max.profileVersion ?? 0) + 1,
            brand: asJson(blocks.brand),
            market: asJson(blocks.market),
            compliance: asJson(blocks.compliance),
            products: asJson(blocks.products),
            feesRef: feesRef ?? null,
            status: 'DRAFT',
          },
        });
      }),
      { field: 'profileVersion' },
    );
    return profileView(profile);
  }

  async activate(tenantId: string, profileVersion: number, projection: unknown): Promise<ActivationResult> {
    const actorId = currentContext()?.actor?.id;
    const domains: string[] = [];
    const result = await conflictOnDuplicate(
      this.db.write(tenantId, async (tx) => {
        const tenant = await lockTenant(tx, tenantId);
        if (tenant.status === 'OFFBOARDED') {
          throw new AppError('CONFLICT', { reason: 'TENANT_OFFBOARDED' });
        }
        const draft = await tx.tenantProfile.findUnique({
          where: { tenantId_profileVersion: { tenantId, profileVersion } },
        });
        if (!draft) {
          throw new AppError('NOT_FOUND', { resource: 'tenant_profile', profileVersion });
        }
        if (draft.status !== 'DRAFT') {
          throw new AppError('CONFLICT', { reason: 'PROFILE_NOT_DRAFT', status: draft.status });
        }
        const document = composeDocument(draft as unknown as ProfileBlocks, projection);
        const previous = await tx.tenantProfile.findFirst({ where: { tenantId, status: 'ACTIVE' } });
        if (previous) {
          await tx.tenantProfile.update({
            where: { id: previous.id },
            data: { status: 'ARCHIVED', version: { increment: 1 } },
          });
        }
        const activated = await tx.tenantProfile.update({
          where: { id: draft.id },
          data: {
            status: 'ACTIVE',
            activatedAt: new Date(),
            approvedBy: actorId !== undefined && isUuid(actorId) ? actorId : null,
            version: { increment: 1 },
          },
        });
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            currentProfileVersion: profileVersion,
            deploymentModel: document.deployment.model,
            region: document.deployment.region,
            ...(tenant.status === 'ONBOARDING' ? { status: 'ACTIVE' } : {}),
            version: { increment: 1 },
          },
        });
        const adaptersChanged = await this.projectAdapters(tx, tenantId, document);
        const domain = await this.projectDomain(tx, tenantId, document);
        if (domain) {
          domains.push(domain);
        }
        await this.projectDeployment(tx, tenant, document);
        await outbox.writePrisma(
          tx,
          tenancyEvent('tenant.profile_changed', tenantId, activated.id, {
            profileVersion,
            previousProfileVersion: previous?.profileVersion ?? null,
            deploymentModel: document.deployment.model,
            region: document.deployment.region,
          }),
        );
        return {
          profile: profileView(activated),
          previousProfileVersion: previous?.profileVersion ?? null,
          adaptersChanged,
        };
      }),
      { field: 'deployment.domain' },
    );
    await invalidateTenantCaches(this.redis, tenantId, domains);
    return result;
  }

  private async requireTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.db.reader.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new AppError('NOT_FOUND', { resource: 'tenant' });
    }
    return tenant;
  }

  private async projectAdapters(tx: Tx, tenantId: string, document: TenantProfileDocument): Promise<number> {
    const desired = desiredAdapters(tenantId, document.adapters);
    const existing = await tx.tenantAdapter.findMany({ where: { tenantId } });
    const key = (partnerType: string, provider: string) => `${partnerType}:${provider}`;
    const existingByKey = new Map(existing.map((adapter) => [key(adapter.partnerType, adapter.provider), adapter]));
    const desiredKeys = new Set(desired.map((adapter) => key(adapter.partnerType, adapter.provider)));
    let changed = 0;
    for (const adapter of desired) {
      const current = existingByKey.get(key(adapter.partnerType, adapter.provider));
      if (
        current?.status === 'ACTIVE' &&
        current.priority === adapter.priority &&
        current.secretRef === adapter.secretRef
      ) {
        continue;
      }
      const saved = current
        ? await tx.tenantAdapter.update({
            where: { id: current.id },
            data: {
              status: 'ACTIVE',
              priority: adapter.priority,
              secretRef: adapter.secretRef,
              version: { increment: 1 },
            },
          })
        : await tx.tenantAdapter.create({
            data: {
              id: newId(),
              tenantId,
              partnerType: adapter.partnerType,
              provider: adapter.provider,
              priority: adapter.priority,
              config: {},
              secretRef: adapter.secretRef,
              status: 'ACTIVE',
            },
          });
      await outbox.writePrisma(
        tx,
        tenancyEvent('tenant.adapter_changed', tenantId, saved.id, {
          adapterId: saved.id,
          partnerType: saved.partnerType,
          provider: saved.provider,
          priority: saved.priority,
          status: saved.status,
        }),
      );
      changed += 1;
    }
    for (const current of existing) {
      if (current.status === 'DISABLED' || desiredKeys.has(key(current.partnerType, current.provider))) {
        continue;
      }
      const disabled = await tx.tenantAdapter.update({
        where: { id: current.id },
        data: { status: 'DISABLED', version: { increment: 1 } },
      });
      await outbox.writePrisma(
        tx,
        tenancyEvent('tenant.adapter_changed', tenantId, disabled.id, {
          adapterId: disabled.id,
          partnerType: disabled.partnerType,
          provider: disabled.provider,
          priority: disabled.priority,
          status: disabled.status,
        }),
      );
      changed += 1;
    }
    return changed;
  }

  private async projectDomain(
    tx: Tx,
    tenantId: string,
    document: TenantProfileDocument,
  ): Promise<string | undefined> {
    const domain = document.deployment.domain.toLowerCase();
    const existing = await tx.tenantDomain.findFirst({ where: { tenantId, domain } });
    if (existing) {
      return undefined;
    }
    const created = await tx.tenantDomain.create({
      data: { id: newId(), tenantId, domain, kind: 'API', tlsStatus: 'PENDING' },
    });
    await outbox.writePrisma(
      tx,
      tenancyEvent('tenant.domain_changed', tenantId, created.id, {
        domainId: created.id,
        domain: created.domain,
        kind: created.kind,
        change: 'ADDED',
        tlsStatus: created.tlsStatus,
      }),
    );
    return domain;
  }

  private async projectDeployment(tx: Tx, tenant: Tenant, document: TenantProfileDocument): Promise<void> {
    const { model, region, version } = document.deployment;
    const existing = await tx.tenantDeployment.findFirst({
      where: { tenantId: tenant.id, environment: 'PROD', region, appVersion: version },
    });
    if (existing) {
      return;
    }
    await tx.tenantDeployment.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        environment: 'PROD',
        cluster: deploymentCluster(tenant, model),
        region,
        appVersion: version,
        status: 'REQUESTED',
      },
    });
  }
}
