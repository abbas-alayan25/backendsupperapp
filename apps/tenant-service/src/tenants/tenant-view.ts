import type { Tenant } from '../gen/prisma/client.js';

export interface TenantView {
  readonly id: string;
  readonly code: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly country: string;
  readonly status: string;
  readonly deploymentModel: string;
  readonly region: string;
  readonly currentProfileVersion: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function tenantView(tenant: Tenant): TenantView {
  return {
    id: tenant.id,
    code: tenant.code,
    legalName: tenant.legalName,
    displayName: tenant.displayName,
    country: tenant.country,
    status: tenant.status,
    deploymentModel: tenant.deploymentModel,
    region: tenant.region,
    currentProfileVersion: tenant.currentProfileVersion,
    version: tenant.version,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}
