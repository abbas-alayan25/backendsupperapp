import { isUuid, requireTenantId } from '@super-app/common';
import { InvalidTenantError } from './database.js';

export interface PrismaTransactionClient {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export interface PrismaLikeClient<Tx extends PrismaTransactionClient> {
  $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { timeout?: number }): Promise<T>;
}

export function withPrismaTenant<Tx extends PrismaTransactionClient, T>(
  prisma: PrismaLikeClient<Tx>,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) {
    return Promise.reject(new InvalidTenantError(tenantId));
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.scope', 'tenant', true)",
      tenantId,
    );
    return fn(tx);
  });
}

export function inPrismaTenantTransaction<Tx extends PrismaTransactionClient, T>(
  prisma: PrismaLikeClient<Tx>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withPrismaTenant(prisma, requireTenantId(), fn);
}
