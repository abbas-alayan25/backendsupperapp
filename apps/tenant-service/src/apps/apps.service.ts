import { Inject, Injectable } from '@nestjs/common';
import { AppError, newId } from '@super-app/common';
import type { TenantApp } from '../gen/prisma/client.js';
import { type TenancyDb, conflictOnDuplicate } from '../shared/tenancy-db.js';
import { TENANCY_DB } from '../shared/tokens.js';

export interface AppView {
  readonly id: string;
  readonly appType: string;
  readonly platform: string;
  readonly bundleId: string;
  readonly storeAccountRef: string | null;
  readonly minSupportedVersion: string;
  readonly latestVersion: string;
  readonly version: number;
}

export interface CreateAppInput {
  readonly appType: 'CONSUMER' | 'MERCHANT' | 'RIDER';
  readonly platform: 'IOS' | 'ANDROID';
  readonly bundleId: string;
  readonly storeAccountRef?: string;
  readonly minSupportedVersion: string;
  readonly latestVersion: string;
}

export function appView(app: TenantApp): AppView {
  return {
    id: app.id,
    appType: app.appType,
    platform: app.platform,
    bundleId: app.bundleId,
    storeAccountRef: app.storeAccountRef,
    minSupportedVersion: app.minSupportedVersion,
    latestVersion: app.latestVersion,
    version: app.version,
  };
}

@Injectable()
export class AppsService {
  constructor(@Inject(TENANCY_DB) private readonly db: TenancyDb) {}

  async list(tenantId: string): Promise<AppView[]> {
    const apps = await this.db.read(tenantId, (tx) =>
      tx.tenantApp.findMany({ where: { tenantId }, orderBy: [{ appType: 'asc' }, { platform: 'asc' }] }),
    );
    return apps.map(appView);
  }

  async create(tenantId: string, input: CreateAppInput): Promise<AppView> {
    const app = await conflictOnDuplicate(
      this.db.write(tenantId, async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) {
          throw new AppError('NOT_FOUND', { resource: 'tenant' });
        }
        return tx.tenantApp.create({
          data: {
            id: newId(),
            tenantId,
            appType: input.appType,
            platform: input.platform,
            bundleId: input.bundleId,
            storeAccountRef: input.storeAccountRef ?? null,
            minSupportedVersion: input.minSupportedVersion,
            latestVersion: input.latestVersion,
          },
        });
      }),
      { field: 'platform' },
    );
    return appView(app);
  }
}
