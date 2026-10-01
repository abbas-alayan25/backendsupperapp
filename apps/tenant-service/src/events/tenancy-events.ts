import type { OutboxEvent } from '@super-app/db';
import { TENANCY_TOPIC, type TenancyEventType } from './catalog.js';

export interface TenantCreatedData {
  readonly code: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly country: string;
  readonly status: string;
  readonly deploymentModel: string;
  readonly region: string;
}

export interface ProfileChangedData {
  readonly profileVersion: number;
  readonly previousProfileVersion: number | null;
  readonly deploymentModel: string;
  readonly region: string;
}

export interface AdapterChangedData {
  readonly adapterId: string;
  readonly partnerType: string;
  readonly provider: string;
  readonly priority: number;
  readonly status: string;
}

export interface StatusChangedData {
  readonly code: string;
  readonly status: string;
  readonly previousStatus: string;
}

export interface DomainChangedData {
  readonly domainId: string;
  readonly domain: string;
  readonly kind: string;
  readonly change: 'ADDED' | 'REMOVED';
  readonly tlsStatus: string | null;
}

interface EventDataByType {
  'tenant.created': TenantCreatedData;
  'tenant.profile_changed': ProfileChangedData;
  'tenant.adapter_changed': AdapterChangedData;
  'tenant.suspended': StatusChangedData;
  'tenant.reactivated': StatusChangedData;
  'tenant.offboarded': StatusChangedData;
  'tenant.domain_changed': DomainChangedData;
}

const AGGREGATE_BY_TYPE: Readonly<Record<TenancyEventType, string>> = {
  'tenant.created': 'tenant',
  'tenant.profile_changed': 'tenant_profile',
  'tenant.adapter_changed': 'tenant_adapter',
  'tenant.suspended': 'tenant',
  'tenant.reactivated': 'tenant',
  'tenant.offboarded': 'tenant',
  'tenant.domain_changed': 'tenant_domain',
};

export function tenancyEvent<T extends TenancyEventType>(
  eventType: T,
  tenantId: string,
  aggregateId: string,
  data: EventDataByType[T],
): OutboxEvent {
  return {
    topic: TENANCY_TOPIC,
    eventType,
    eventVersion: 1,
    aggregateType: AGGREGATE_BY_TYPE[eventType],
    aggregateId,
    ownerId: tenantId,
    tenantId,
    payload: data,
  };
}
