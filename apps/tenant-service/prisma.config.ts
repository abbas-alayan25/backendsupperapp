import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env.TENANCY_MIGRATION_DATABASE_URL ??
      'postgresql://superapp:superapp-local@localhost:55432/superapp',
  },
});
