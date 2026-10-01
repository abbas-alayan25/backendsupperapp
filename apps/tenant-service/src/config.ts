export interface TenantServiceConfig {
  readonly appDatabaseUrl: string;
  readonly syncDatabaseUrl: string;
  readonly relayDatabaseUrl: string;
  readonly redisUrl: string;
  readonly kafkaBrokers: readonly string[];
  readonly schemaRegistryUrl: string;
  readonly vaultAddress: string;
  readonly vaultToken: string;
  readonly consoleJwksUrl: string;
  readonly consoleIssuer: string;
  readonly cursorSecret: string;
}

const LOCAL_DB = 'localhost:55432/superapp';
const LOCAL_PASSWORD = 'tenant-service-local';

function value(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const configured = env[name];
  if (configured) {
    return configured;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(`${name} is required in production`);
  }
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TenantServiceConfig {
  return {
    appDatabaseUrl: value(env, 'TENANCY_DATABASE_URL', `postgresql://tenant_service:${LOCAL_PASSWORD}@${LOCAL_DB}`),
    syncDatabaseUrl: value(
      env,
      'TENANCY_SYNC_DATABASE_URL',
      `postgresql://tenant_service_sync:${LOCAL_PASSWORD}@${LOCAL_DB}`,
    ),
    relayDatabaseUrl: value(
      env,
      'TENANCY_RELAY_DATABASE_URL',
      `postgresql://tenant_service_relay:${LOCAL_PASSWORD}@${LOCAL_DB}`,
    ),
    redisUrl: value(env, 'REDIS_URL', 'redis://localhost:6379'),
    kafkaBrokers: value(env, 'KAFKA_BROKERS', 'localhost:9092').split(','),
    schemaRegistryUrl: value(env, 'SCHEMA_REGISTRY_URL', 'http://localhost:8081'),
    vaultAddress: value(env, 'VAULT_ADDR', 'http://localhost:8200'),
    vaultToken: value(env, 'VAULT_TOKEN', 'superapp-dev-root'),
    consoleJwksUrl: value(
      env,
      'CONSOLE_JWKS_URL',
      'http://localhost:8080/realms/platform/protocol/openid-connect/certs',
    ),
    consoleIssuer: value(env, 'CONSOLE_ISSUER', 'http://localhost:8080/realms/platform'),
    cursorSecret: value(env, 'CURSOR_SECRET', 'local-development-cursor-secret-0123456789'),
  };
}

export const LOCAL_ROLE_PASSWORD = LOCAL_PASSWORD;
