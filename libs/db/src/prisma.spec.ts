import { describe, expect, it } from 'vitest';
import { InvalidTenantError } from './database.js';
import { type PrismaTransactionClient, withPrismaTenant } from './prisma.js';

class FakeTx implements PrismaTransactionClient {
  readonly calls: { query: string; values: unknown[] }[] = [];
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
    this.calls.push({ query, values });
    return Promise.resolve(1);
  }
}

describe('withPrismaTenant', () => {
  const tenantId = '0192f5a0-0000-7000-8000-000000000001';

  it('sets the tenant as the first statement of the transaction', async () => {
    const tx = new FakeTx();
    const prisma = { $transaction: <T>(fn: (t: FakeTx) => Promise<T>) => fn(tx) };
    const result = await withPrismaTenant(prisma, tenantId, (t) => {
      expect(t.calls).toHaveLength(1);
      return Promise.resolve('done');
    });
    expect(result).toBe('done');
    expect(tx.calls[0]?.query).toContain("set_config('app.tenant_id', $1, true)");
    expect(tx.calls[0]?.values).toEqual([tenantId]);
  });

  it('rejects non-UUID tenants before opening a transaction', async () => {
    let opened = false;
    const prisma = {
      $transaction: <T>(fn: (t: FakeTx) => Promise<T>) => {
        opened = true;
        return fn(new FakeTx());
      },
    };
    await expect(
      withPrismaTenant(prisma, "x' OR '1'='1", () => Promise.resolve(1)),
    ).rejects.toBeInstanceOf(InvalidTenantError);
    expect(opened).toBe(false);
  });
});
