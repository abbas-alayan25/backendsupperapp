import type { Topic } from '@super-app/common';
import { type AvroField, EventCatalog } from '@super-app/kafka';

export const TENANCY_TOPIC: Topic = 'tenancy.tenants';
export const PRODUCER = 'tenant-service';

const nullableString = (name: string): AvroField => ({ name, type: ['null', 'string'], default: null });
const nullableInt = (name: string): AvroField => ({ name, type: ['null', 'int'], default: null });

const statusChangeFields: readonly AvroField[] = [
  { name: 'code', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'previousStatus', type: 'string' },
];

export const TENANCY_EVENT_FIELDS = {
  'tenant.created': [
    { name: 'code', type: 'string' },
    { name: 'legalName', type: 'string' },
    { name: 'displayName', type: 'string' },
    { name: 'country', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'deploymentModel', type: 'string' },
    { name: 'region', type: 'string' },
  ],
  'tenant.profile_changed': [
    { name: 'profileVersion', type: 'int' },
    nullableInt('previousProfileVersion'),
    { name: 'deploymentModel', type: 'string' },
    { name: 'region', type: 'string' },
  ],
  'tenant.adapter_changed': [
    { name: 'adapterId', type: 'string' },
    { name: 'partnerType', type: 'string' },
    { name: 'provider', type: 'string' },
    { name: 'priority', type: 'int' },
    { name: 'status', type: 'string' },
  ],
  'tenant.suspended': statusChangeFields,
  'tenant.reactivated': statusChangeFields,
  'tenant.offboarded': statusChangeFields,
  'tenant.domain_changed': [
    { name: 'domainId', type: 'string' },
    { name: 'domain', type: 'string' },
    { name: 'kind', type: 'string' },
    { name: 'change', type: 'string' },
    nullableString('tlsStatus'),
  ],
} as const satisfies Record<string, readonly AvroField[]>;

export type TenancyEventType = keyof typeof TENANCY_EVENT_FIELDS;

export function tenancyCatalog(): EventCatalog {
  return new EventCatalog(
    Object.entries(TENANCY_EVENT_FIELDS).map(([eventType, dataFields]) => ({
      topic: TENANCY_TOPIC,
      eventType,
      dataFields,
    })),
  );
}
