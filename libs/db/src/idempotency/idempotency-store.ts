import { randomUUID } from 'node:crypto';
import { type Actor, AppError, newId } from '@super-app/common';
import type { Redis } from 'ioredis';
import { type Kysely, sql } from 'kysely';
import { withTenant } from '../database.js';
import type { StdTables } from '../std-tables.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_LOCK_MS = 60_000;

export interface IdempotencyRequest {
  readonly tenantId: string;
  readonly key: string;
  readonly actor: Actor;
  readonly requestHash: string;
}

export type BeginResult =
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'proceed'; readonly lockToken: string };

const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export function idempotencyLockKey(tenantId: string, key: string): string {
  return `t:${tenantId}:idem:${key}`;
}

export function isStorableStatus(status: number): boolean {
  return status >= 200 && status < 500;
}

export class IdempotencyStore<DB = StdTables> {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly redis: Redis,
    private readonly schema: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async begin(request: IdempotencyRequest): Promise<BeginResult> {
    const stored = await this.find(request);
    if (stored) {
      return this.resolveStored(request, stored);
    }
    const lockToken = randomUUID();
    const acquired = await this.redis.set(
      idempotencyLockKey(request.tenantId, request.key),
      lockToken,
      'PX',
      IDEMPOTENCY_LOCK_MS,
      'NX',
    );
    if (acquired !== 'OK') {
      throw new AppError('CONFLICT', { reason: 'REQUEST_IN_FLIGHT' }, { retryAfterSeconds: 1 });
    }
    const raced = await this.find(request);
    if (raced) {
      await this.release(request, lockToken);
      return this.resolveStored(request, raced);
    }
    return { kind: 'proceed', lockToken };
  }

  async complete(
    request: IdempotencyRequest,
    lockToken: string,
    response: { status: number; body: unknown },
  ): Promise<void> {
    try {
      if (!isStorableStatus(response.status)) {
        return;
      }
      const now = this.now();
      await withTenant(this.db as unknown as Kysely<StdTables>, request.tenantId, async (trx) => {
        await trx
          .withSchema(this.schema)
          .insertInto('idempotency_keys')
          .values({
            id: newId(),
            tenant_id: request.tenantId,
            key: request.key,
            actor_type: request.actor.type,
            actor_id: request.actor.id,
            request_hash: request.requestHash,
            response_code: response.status,
            response_body: JSON.stringify(response.body ?? null),
            locked_until: null,
            expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          })
          .onConflict((conflict) =>
            conflict
              .columns(['tenant_id', 'key'])
              .doUpdateSet((eb) => ({
                actor_type: eb.ref('excluded.actor_type'),
                actor_id: eb.ref('excluded.actor_id'),
                request_hash: eb.ref('excluded.request_hash'),
                response_code: eb.ref('excluded.response_code'),
                response_body: eb.ref('excluded.response_body'),
                expires_at: eb.ref('excluded.expires_at'),
                created_at: sql<Date>`now()`,
              }))
              .where('idempotency_keys.expires_at', '<', now),
          )
          .execute();
      });
    } finally {
      await this.release(request, lockToken);
    }
  }

  async abandon(request: IdempotencyRequest, lockToken: string): Promise<void> {
    await this.release(request, lockToken);
  }

  private async release(request: IdempotencyRequest, lockToken: string): Promise<void> {
    await this.redis.eval(
      RELEASE_LOCK,
      1,
      idempotencyLockKey(request.tenantId, request.key),
      lockToken,
    );
  }

  private async find(request: IdempotencyRequest) {
    const now = this.now();
    return withTenant(this.db as unknown as Kysely<StdTables>, request.tenantId, (trx) =>
      trx
        .withSchema(this.schema)
        .selectFrom('idempotency_keys')
        .select(['actor_type', 'actor_id', 'request_hash', 'response_code', 'response_body'])
        .where('key', '=', request.key)
        .where('expires_at', '>', now)
        .executeTakeFirst(),
    );
  }

  private resolveStored(
    request: IdempotencyRequest,
    stored: {
      actor_type: string;
      actor_id: string;
      request_hash: string;
      response_code: number | null;
      response_body: unknown;
    },
  ): BeginResult {
    if (stored.actor_type !== request.actor.type || stored.actor_id !== request.actor.id) {
      throw new AppError('CONFLICT', { reason: 'KEY_USED_BY_ANOTHER_ACTOR' });
    }
    if (stored.request_hash !== request.requestHash) {
      throw new AppError('DUPLICATE_REQUEST', { reason: 'KEY_REUSED_WITH_DIFFERENT_REQUEST' });
    }
    return { kind: 'replay', status: stored.response_code ?? 200, body: stored.response_body };
  }
}
