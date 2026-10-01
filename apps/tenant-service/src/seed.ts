import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { seedDemoTenants } from './seed/seed-demo.js';
import { TenancyDb, createPrisma } from './shared/tenancy-db.js';

const config = loadConfig();
const db = new TenancyDb(
  createPrisma(config.appDatabaseUrl, 'tenant-service-seed'),
  createPrisma(config.syncDatabaseUrl, 'tenant-service-seed'),
);
const redis = new Redis(config.redisUrl);
try {
  const report = await seedDemoTenants(db, redis);
  process.stdout.write(`demo tenants created: ${report.created.join(', ') || 'none'}; skipped: ${report.skipped.join(', ') || 'none'}\n`);
} finally {
  await db.disconnect();
  redis.disconnect();
}
