import { AdapterRegistry, registerSimulators } from '@super-app/adapters';
import { VaultClient } from '@super-app/common';
import { type StdTables, createDatabase } from '@super-app/db';
import { createRemoteJWKSet } from 'jose';
import { Redis } from 'ioredis';
import type { TenantServiceDependencies } from './app.module.js';
import type { TenantServiceConfig } from './config.js';
import { KeycloakConsoleResolver } from './console-auth/keycloak-console-resolver.js';
import { DirectAdapterSource } from './adapters/direct-adapter-source.js';
import { TenancyDb, createPrisma } from './shared/tenancy-db.js';

export function createDependencies(config: TenantServiceConfig): TenantServiceDependencies {
  const db = new TenancyDb(
    createPrisma(config.appDatabaseUrl, 'tenant-service'),
    createPrisma(config.syncDatabaseUrl, 'tenant-service-sync'),
  );
  const idempotencyDb = createDatabase<StdTables>({
    connectionString: config.syncDatabaseUrl,
    applicationName: 'tenant-service-idempotency',
    maxConnections: 5,
  });
  const redis = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 });
  const vault = new VaultClient({ address: config.vaultAddress, token: config.vaultToken });
  const registry = registerSimulators(new AdapterRegistry(new DirectAdapterSource(db), vault));
  const adminResolver = new KeycloakConsoleResolver(
    createRemoteJWKSet(new URL(config.consoleJwksUrl)),
    config.consoleIssuer,
  );
  return {
    db,
    idempotencyDb,
    redis,
    registry,
    adminResolver,
    cursorSecret: config.cursorSecret,
    onShutdown: async () => {
      await db.disconnect();
      await idempotencyDb.destroy();
      redis.disconnect();
    },
  };
}
