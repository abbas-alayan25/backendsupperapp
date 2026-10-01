import { provisionLoginRoles } from './db/provision.js';

const url = process.env.TENANCY_MIGRATION_DATABASE_URL ?? 'postgresql://superapp:superapp-local@localhost:55432/superapp';
await provisionLoginRoles(url);
process.stdout.write('tenancy login roles provisioned\n');
