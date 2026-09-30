import { newId } from '@super-app/common';

export interface TenantPair {
  readonly tenantA: string;
  readonly tenantB: string;
}

export function twoTenants(): TenantPair {
  return { tenantA: newId(), tenantB: newId() };
}
