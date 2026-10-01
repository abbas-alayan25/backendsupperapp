import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TENANCY_EVENT_FIELDS, tenancyCatalog } from './catalog.js';
import { tenancyEvent } from './tenancy-events.js';

const EVENTS_DOC = readFileSync(new URL('../../../../docs/events.md', import.meta.url), 'utf8');

describe('tenancy event catalog', () => {
  it('defines exactly the tenancy.tenants event types listed in docs/events.md', () => {
    const section = EVENTS_DOC.split('### `tenancy.tenants`')[1]?.split('###')[0] ?? '';
    const documented = [...section.matchAll(/`(tenant\.[a-z_]+)`/g)].map((match) => match[1]).sort();
    expect(Object.keys(TENANCY_EVENT_FIELDS).sort()).toEqual(documented);
  });

  it('builds Avro schemas for every event', () => {
    const catalog = tenancyCatalog();
    expect(catalog.all()).toHaveLength(7);
    expect(catalog.get('tenancy.tenants', 'tenant.profile_changed').subject).toBe(
      'tenancy.tenants-superapp.events.tenancy.TenantProfileChanged',
    );
  });

  it('keys every event by tenant id', () => {
    const event = tenancyEvent('tenant.suspended', 'tenant-1', '0192f5a0-0000-7000-8000-000000000001', {
      code: 'acme',
      status: 'SUSPENDED',
      previousStatus: 'ACTIVE',
    });
    expect(event).toMatchObject({ topic: 'tenancy.tenants', ownerId: 'tenant-1', tenantId: 'tenant-1', eventVersion: 1 });
  });
});
