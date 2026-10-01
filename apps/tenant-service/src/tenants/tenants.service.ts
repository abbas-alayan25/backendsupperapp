import { Inject, Injectable } from '@nestjs/common';
import { AppError, CursorCodec, type Page, newId, parseLimit, toPage } from '@super-app/common';
import type { Redis } from 'ioredis';
import { tenancyEvent } from '../events/tenancy-events.js';
import type { Tenant } from '../gen/prisma/client.js';
import { invalidateTenantCaches } from '../shared/cache.js';
import { outbox } from '../shared/outbox.js';
import { type TenancyDb, type Tx, conflictOnDuplicate } from '../shared/tenancy-db.js';
import { CURSOR_CODEC, REDIS, TENANCY_DB } from '../shared/tokens.js';
import { type TenantView, tenantView } from './tenant-view.js';

export interface CreateTenantInput {
  readonly id?: string;
  readonly code: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly country: string;
  readonly deploymentModel: 'SHARED' | 'DEDICATED';
  readonly region: string;
}

export interface UpdateTenantInput {
  readonly legalName?: string;
  readonly displayName?: string;
  readonly version?: number;
}

type StatusTransition = 'suspend' | 'reactivate';

const TRANSITIONS: Readonly<
  Record<StatusTransition, { from: string; to: string; event: 'tenant.suspended' | 'tenant.reactivated' }>
> = {
  suspend: { from: 'ACTIVE', to: 'SUSPENDED', event: 'tenant.suspended' },
  reactivate: { from: 'SUSPENDED', to: 'ACTIVE', event: 'tenant.reactivated' },
};

export async function lockTenant(tx: Tx, tenantId: string): Promise<Tenant> {
  await tx.$queryRaw`SELECT id FROM tenancy.tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    throw new AppError('NOT_FOUND', { resource: 'tenant' });
  }
  return tenant;
}

@Injectable()
export class TenantsService {
  constructor(
    @Inject(TENANCY_DB) private readonly db: TenancyDb,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CURSOR_CODEC) private readonly cursors: CursorCodec,
  ) {}

  async create(input: CreateTenantInput): Promise<TenantView> {
    const id = input.id ?? newId();
    const tenant = await conflictOnDuplicate(
      this.db.write(id, async (tx) => {
        const created = await tx.tenant.create({
          data: {
            id,
            code: input.code,
            legalName: input.legalName,
            displayName: input.displayName,
            country: input.country,
            status: 'ONBOARDING',
            deploymentModel: input.deploymentModel,
            region: input.region,
          },
        });
        await outbox.writePrisma(
          tx,
          tenancyEvent('tenant.created', id, id, {
            code: created.code,
            legalName: created.legalName,
            displayName: created.displayName,
            country: created.country,
            status: created.status,
            deploymentModel: created.deploymentModel,
            region: created.region,
          }),
        );
        return created;
      }),
      { field: 'code' },
    );
    return tenantView(tenant);
  }

  async list(query: { limit?: string; cursor?: string; status?: string }): Promise<Page<TenantView>> {
    const limit = parseLimit(query.limit);
    const after = query.cursor ? this.cursors.decode(query.cursor).id : undefined;
    const rows = await this.db.reader.tenant.findMany({
      where: {
        ...(typeof after === 'string' ? { id: { gt: after } } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const page = toPage(rows, limit, (last) => this.cursors.encode({ id: last.id }));
    return { data: page.data.map(tenantView), nextCursor: page.nextCursor };
  }

  async get(tenantId: string): Promise<TenantView> {
    const tenant = await this.db.reader.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new AppError('NOT_FOUND', { resource: 'tenant' });
    }
    return tenantView(tenant);
  }

  async update(tenantId: string, input: UpdateTenantInput): Promise<TenantView> {
    const tenant = await this.db.write(tenantId, async (tx) => {
      const current = await lockTenant(tx, tenantId);
      if (input.version !== undefined && input.version !== current.version) {
        throw new AppError('CONFLICT', { reason: 'VERSION_MISMATCH', currentVersion: current.version });
      }
      return tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...(input.legalName === undefined ? {} : { legalName: input.legalName }),
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          version: { increment: 1 },
        },
      });
    });
    await invalidateTenantCaches(this.redis, tenantId);
    return tenantView(tenant);
  }

  async transition(tenantId: string, transition: StatusTransition): Promise<TenantView> {
    const rule = TRANSITIONS[transition];
    const tenant = await this.db.write(tenantId, async (tx) => {
      const current = await lockTenant(tx, tenantId);
      if (current.status !== rule.from) {
        throw new AppError('CONFLICT', {
          reason: 'ILLEGAL_STATUS_TRANSITION',
          status: current.status,
          transition,
        });
      }
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: { status: rule.to, version: { increment: 1 } },
      });
      await outbox.writePrisma(
        tx,
        tenancyEvent(rule.event, tenantId, tenantId, {
          code: updated.code,
          status: updated.status,
          previousStatus: current.status,
        }),
      );
      return updated;
    });
    await invalidateTenantCaches(this.redis, tenantId);
    return tenantView(tenant);
  }
}
