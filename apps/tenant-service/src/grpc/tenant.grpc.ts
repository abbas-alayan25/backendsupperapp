import { Inject, Injectable } from '@nestjs/common';
import { partnerTypeFromProto } from '@super-app/adapters';
import { AppError, requireTenantId } from '@super-app/common';
import type { GrpcServiceBinding } from '@super-app/nest';
import { platformUnary, tenantV1, unary } from '@super-app/proto';
import type { Redis } from 'ioredis';
import type { Tenant, TenantProfile } from '../gen/prisma/client.js';
import { DOMAIN_CACHE_TTL_SECONDS, domainCacheKey } from '../shared/cache.js';
import type { TenancyDb } from '../shared/tenancy-db.js';
import { REDIS, TENANCY_DB } from '../shared/tokens.js';

const TENANT_STATUS: Readonly<Record<string, tenantV1.TenantStatus>> = {
  ONBOARDING: tenantV1.TenantStatus.TENANT_STATUS_ONBOARDING,
  ACTIVE: tenantV1.TenantStatus.TENANT_STATUS_ACTIVE,
  SUSPENDED: tenantV1.TenantStatus.TENANT_STATUS_SUSPENDED,
  OFFBOARDED: tenantV1.TenantStatus.TENANT_STATUS_OFFBOARDED,
};

const DEPLOYMENT_MODEL: Readonly<Record<string, tenantV1.DeploymentModel>> = {
  SHARED: tenantV1.DeploymentModel.DEPLOYMENT_MODEL_SHARED,
  DEDICATED: tenantV1.DeploymentModel.DEPLOYMENT_MODEL_DEDICATED,
};

const DOMAIN_KIND: Readonly<Record<string, tenantV1.DomainKind>> = {
  API: tenantV1.DomainKind.DOMAIN_KIND_API,
  ADMIN: tenantV1.DomainKind.DOMAIN_KIND_ADMIN,
  MERCHANT: tenantV1.DomainKind.DOMAIN_KIND_MERCHANT,
  WEB: tenantV1.DomainKind.DOMAIN_KIND_WEB,
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

export function toProtoTenant(tenant: Tenant): tenantV1.Tenant {
  return {
    id: tenant.id,
    code: tenant.code,
    legalName: tenant.legalName,
    displayName: tenant.displayName,
    country: tenant.country,
    status: TENANT_STATUS[tenant.status] ?? tenantV1.TenantStatus.TENANT_STATUS_UNSPECIFIED,
    deploymentModel: DEPLOYMENT_MODEL[tenant.deploymentModel] ?? tenantV1.DeploymentModel.DEPLOYMENT_MODEL_UNSPECIFIED,
    region: tenant.region,
    currentProfileVersion: tenant.currentProfileVersion ?? 0,
  };
}

function toProtoProfile(profile: TenantProfile): tenantV1.TenantProfile {
  return {
    profileVersion: profile.profileVersion,
    brand: asObject(profile.brand),
    market: asObject(profile.market),
    compliance: asObject(profile.compliance),
    products: asObject(profile.products),
    feesRef: profile.feesRef ?? '',
  };
}

interface CachedDomain {
  readonly tenantId: string;
  readonly kind: string;
}

@Injectable()
export class TenantGrpcService {
  constructor(
    @Inject(TENANCY_DB) private readonly db: TenancyDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  binding(): GrpcServiceBinding {
    return {
      definition: tenantV1.TenantServiceService,
      implementation: {
        getProfile: unary<tenantV1.GetProfileRequest, tenantV1.GetProfileResponse>(() => this.getProfile()),
        resolveAdapter: unary<tenantV1.ResolveAdapterRequest, tenantV1.ResolveAdapterResponse>((request) =>
          this.resolveAdapter(request),
        ),
        resolveDomain: platformUnary<tenantV1.ResolveDomainRequest, tenantV1.ResolveDomainResponse>((request) =>
          this.resolveDomain(request),
        ),
        listActiveTenants: platformUnary<tenantV1.ListActiveTenantsRequest, tenantV1.ListActiveTenantsResponse>(() =>
          this.listActiveTenants(),
        ),
      },
    };
  }

  async getProfile(): Promise<tenantV1.GetProfileResponse> {
    const tenantId = requireTenantId();
    const tenant = await this.db.reader.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new AppError('NOT_FOUND', { resource: 'tenant' });
    }
    const profile =
      tenant.currentProfileVersion === null
        ? null
        : await this.db.read(tenantId, (tx) =>
            tx.tenantProfile.findFirst({ where: { tenantId, status: 'ACTIVE' } }),
          );
    return { tenant: toProtoTenant(tenant), profile: profile ? toProtoProfile(profile) : undefined };
  }

  async resolveAdapter(request: tenantV1.ResolveAdapterRequest): Promise<tenantV1.ResolveAdapterResponse> {
    const tenantId = requireTenantId();
    const partnerType = partnerTypeFromProto(request.partnerType);
    if (!partnerType) {
      throw new AppError('VALIDATION_FAILED', { field: 'partnerType', reason: 'UNSPECIFIED' });
    }
    const adapters = await this.db.read(tenantId, (tx) =>
      tx.tenantAdapter.findMany({
        where: { tenantId, partnerType, status: 'ACTIVE' },
        orderBy: [{ priority: 'asc' }, { provider: 'asc' }],
      }),
    );
    return {
      adapters: adapters.map((adapter) => ({
        id: adapter.id,
        partnerType: request.partnerType,
        provider: adapter.provider,
        priority: adapter.priority,
        config: asObject(adapter.config),
        secretRef: adapter.secretRef,
      })),
    };
  }

  async resolveDomain(request: tenantV1.ResolveDomainRequest): Promise<tenantV1.ResolveDomainResponse> {
    const domain = request.domain.trim().toLowerCase();
    if (domain.length === 0) {
      throw new AppError('VALIDATION_FAILED', { field: 'domain', reason: 'REQUIRED' });
    }
    const found = (await this.cachedDomain(domain)) ?? (await this.lookupDomain(domain));
    if (!found) {
      throw new AppError('NOT_FOUND', { resource: 'tenant_domain' });
    }
    const tenant = await this.db.reader.tenant.findUnique({ where: { id: found.tenantId } });
    if (!tenant) {
      throw new AppError('NOT_FOUND', { resource: 'tenant' });
    }
    return {
      tenantId: tenant.id,
      kind: DOMAIN_KIND[found.kind] ?? tenantV1.DomainKind.DOMAIN_KIND_UNSPECIFIED,
      status: TENANT_STATUS[tenant.status] ?? tenantV1.TenantStatus.TENANT_STATUS_UNSPECIFIED,
    };
  }

  async listActiveTenants(): Promise<tenantV1.ListActiveTenantsResponse> {
    const tenants = await this.db.reader.tenant.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    return { tenants: tenants.map(toProtoTenant) };
  }

  private async cachedDomain(domain: string): Promise<CachedDomain | undefined> {
    const cached = await this.redis.get(domainCacheKey(domain));
    return cached ? (JSON.parse(cached) as CachedDomain) : undefined;
  }

  private async lookupDomain(domain: string): Promise<CachedDomain | undefined> {
    const tenants = await this.db.reader.tenant.findMany({
      where: { status: { not: 'OFFBOARDED' } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const { id } of tenants) {
      const match = await this.db.read(id, (tx) => tx.tenantDomain.findFirst({ where: { tenantId: id, domain } }));
      if (match) {
        const found: CachedDomain = { tenantId: id, kind: match.kind };
        await this.redis.set(domainCacheKey(domain), JSON.stringify(found), 'EX', DOMAIN_CACHE_TTL_SECONDS);
        return found;
      }
    }
    return undefined;
  }
}
