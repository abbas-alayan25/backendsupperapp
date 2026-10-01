import { profileCacheKey } from '@super-app/adapters';
import type { Redis } from 'ioredis';

export const DOMAIN_CACHE_TTL_SECONDS = 300;

export function domainCacheKey(domain: string): string {
  return `platform:domain:${domain.toLowerCase()}`;
}

export async function invalidateTenantCaches(redis: Redis, tenantId: string, domains: readonly string[] = []): Promise<void> {
  await redis.del(profileCacheKey(tenantId), ...domains.map(domainCacheKey));
}
