import type { TenantProfile } from '../gen/prisma/client.js';

export interface ProfileView {
  readonly id: string;
  readonly tenantId: string;
  readonly profileVersion: number;
  readonly status: string;
  readonly brand: unknown;
  readonly market: unknown;
  readonly compliance: unknown;
  readonly products: unknown;
  readonly feesRef: string | null;
  readonly approvedBy: string | null;
  readonly activatedAt: string | null;
  readonly createdAt: string;
}

export function profileView(profile: TenantProfile): ProfileView {
  return {
    id: profile.id,
    tenantId: profile.tenantId,
    profileVersion: profile.profileVersion,
    status: profile.status,
    brand: profile.brand,
    market: profile.market,
    compliance: profile.compliance,
    products: profile.products,
    feesRef: profile.feesRef,
    approvedBy: profile.approvedBy,
    activatedAt: profile.activatedAt?.toISOString() ?? null,
    createdAt: profile.createdAt.toISOString(),
  };
}
