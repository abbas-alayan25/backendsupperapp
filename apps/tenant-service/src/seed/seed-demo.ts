import { CursorCodec } from '@super-app/common';
import type { Redis } from 'ioredis';
import { DomainsService } from '../domains/domains.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import type { TenancyDb } from '../shared/tenancy-db.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { DEMO_TENANT_SEEDS, type DemoTenantSeed } from './demo-tenants.js';

export interface SeedReport {
  readonly created: string[];
  readonly skipped: string[];
}

const SEED_CURSOR_SECRET = 'seed-cursor-secret-not-used-for-paging';

async function seedTenant(db: TenancyDb, redis: Redis, seed: DemoTenantSeed): Promise<boolean> {
  const existing = await db.reader.tenant.findUnique({ where: { id: seed.id } });
  if (existing?.currentProfileVersion != null) {
    return false;
  }
  const tenants = new TenantsService(db, redis, new CursorCodec(SEED_CURSOR_SECRET));
  const profiles = new ProfilesService(db, redis);
  const domains = new DomainsService(db, redis);
  if (!existing) {
    await tenants.create({
      id: seed.id,
      code: seed.code,
      legalName: seed.legalName,
      displayName: seed.displayName,
      country: seed.country,
      deploymentModel: seed.profile.deployment.model,
      region: seed.profile.deployment.region,
    });
  }
  const { adapters, deployment } = seed.profile;
  const drafts = await profiles.list(seed.id);
  const draft = drafts.find((profile) => profile.status === 'DRAFT') ?? (await profiles.createDraft(seed.id, seed.profile));
  await profiles.activate(seed.id, draft.profileVersion, { adapters, deployment });
  const current = new Set((await domains.list(seed.id)).map((domain) => domain.domain));
  for (const extra of seed.extraDomains) {
    if (!current.has(extra.domain)) {
      await domains.create(seed.id, extra);
    }
  }
  return true;
}

export async function seedDemoTenants(db: TenancyDb, redis: Redis): Promise<SeedReport> {
  const report: SeedReport = { created: [], skipped: [] };
  for (const seed of DEMO_TENANT_SEEDS) {
    if (await seedTenant(db, redis, seed)) {
      report.created.push(seed.code);
    } else {
      report.skipped.push(seed.code);
    }
  }
  return report;
}
