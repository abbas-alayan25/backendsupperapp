import { Inject, Injectable } from '@nestjs/common';
import { AppError, newId } from '@super-app/common';
import type { Redis } from 'ioredis';
import { tenancyEvent } from '../events/tenancy-events.js';
import type { TenantDomain } from '../gen/prisma/client.js';
import { invalidateTenantCaches } from '../shared/cache.js';
import { outbox } from '../shared/outbox.js';
import { type TenancyDb, conflictOnDuplicate } from '../shared/tenancy-db.js';
import { REDIS, TENANCY_DB } from '../shared/tokens.js';

export interface DomainView {
  readonly id: string;
  readonly domain: string;
  readonly kind: string;
  readonly tlsStatus: string;
  readonly createdAt: string;
}

export interface CreateDomainInput {
  readonly domain: string;
  readonly kind: 'API' | 'ADMIN' | 'MERCHANT' | 'WEB';
}

export function domainView(domain: TenantDomain): DomainView {
  return {
    id: domain.id,
    domain: domain.domain,
    kind: domain.kind,
    tlsStatus: domain.tlsStatus,
    createdAt: domain.createdAt.toISOString(),
  };
}

@Injectable()
export class DomainsService {
  constructor(
    @Inject(TENANCY_DB) private readonly db: TenancyDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async list(tenantId: string): Promise<DomainView[]> {
    const domains = await this.db.read(tenantId, (tx) =>
      tx.tenantDomain.findMany({ where: { tenantId }, orderBy: { domain: 'asc' } }),
    );
    return domains.map(domainView);
  }

  async create(tenantId: string, input: CreateDomainInput): Promise<DomainView> {
    const domainName = input.domain.toLowerCase();
    const domain = await conflictOnDuplicate(
      this.db.write(tenantId, async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) {
          throw new AppError('NOT_FOUND', { resource: 'tenant' });
        }
        const created = await tx.tenantDomain.create({
          data: { id: newId(), tenantId, domain: domainName, kind: input.kind, tlsStatus: 'PENDING' },
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
        return created;
      }),
      { field: 'domain' },
    );
    await invalidateTenantCaches(this.redis, tenantId, [domain.domain]);
    return domainView(domain);
  }

  async remove(tenantId: string, domainId: string): Promise<void> {
    const removed = await this.db.write(tenantId, async (tx) => {
      const domain = await tx.tenantDomain.findFirst({ where: { id: domainId, tenantId } });
      if (!domain) {
        throw new AppError('NOT_FOUND', { resource: 'tenant_domain' });
      }
      await tx.tenantDomain.delete({ where: { id: domain.id } });
      await outbox.writePrisma(
        tx,
        tenancyEvent('tenant.domain_changed', tenantId, domain.id, {
          domainId: domain.id,
          domain: domain.domain,
          kind: domain.kind,
          change: 'REMOVED',
          tlsStatus: null,
        }),
      );
      return domain;
    });
    await invalidateTenantCaches(this.redis, tenantId, [removed.domain]);
  }
}
