import { type ChannelCredentials, Metadata, credentials } from '@grpc/grpc-js';
import { DEFAULT_LOCALE, type Topic, newId, runWithContext } from '@super-app/common';
import type { Consumer, KafkaClient } from '@super-app/kafka';
import { createGrpcClient, tenantV1 } from '@super-app/proto';
import type { Redis } from 'ioredis';
import type { AdapterRecord, AdapterSource } from './registry.js';
import { type PartnerType, adapterSecretPath } from './types.js';

export const PROFILE_CACHE_TTL_SECONDS = 300;
export const ADAPTER_CACHE_TTL_MS = 60_000;
const ASSIGNMENT_TIMEOUT_MS = 60_000;
const TENANCY_TOPIC: Topic = 'tenancy.tenants';

const PARTNER_TYPE_TO_PROTO: Readonly<Record<PartnerType, tenantV1.PartnerType>> = {
  BANK: tenantV1.PartnerType.PARTNER_TYPE_BANK,
  CARD_ISSUER: tenantV1.PartnerType.PARTNER_TYPE_CARD_ISSUER,
  KYC: tenantV1.PartnerType.PARTNER_TYPE_KYC,
  ACQUIRER: tenantV1.PartnerType.PARTNER_TYPE_ACQUIRER,
  BILLER: tenantV1.PartnerType.PARTNER_TYPE_BILLER,
  SMS: tenantV1.PartnerType.PARTNER_TYPE_SMS,
  EMAIL: tenantV1.PartnerType.PARTNER_TYPE_EMAIL,
  PUSH: tenantV1.PartnerType.PARTNER_TYPE_PUSH,
};

export function partnerTypeToProto(partnerType: PartnerType): tenantV1.PartnerType {
  return PARTNER_TYPE_TO_PROTO[partnerType];
}

export function partnerTypeFromProto(value: tenantV1.PartnerType): PartnerType | undefined {
  const match = Object.entries(PARTNER_TYPE_TO_PROTO).find(([, proto]) => proto === value);
  return match?.[0] as PartnerType | undefined;
}

export function profileCacheKey(tenantId: string): string {
  return `t:${tenantId}:profile`;
}

type UnaryCall<Req, Res> = (
  request: Req,
  metadata: Metadata,
  callback: (error: Error | null, response: Res) => void,
) => unknown;

function call<Req, Res>(method: UnaryCall<Req, Res>, request: Req): Promise<Res> {
  return new Promise((resolve, reject) => {
    method(request, new Metadata(), (error, response) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}

export interface TenantDirectoryOptions {
  readonly address: string;
  readonly redis: Redis;
  readonly profileTtlSeconds?: number;
  readonly adapterTtlMs?: number;
  readonly channelCredentials?: ChannelCredentials;
}

export class TenantDirectory implements AdapterSource {
  private readonly client: tenantV1.TenantServiceClient;
  private readonly adapters = new Map<string, { records: AdapterRecord[]; expiresAt: number }>();
  private readonly listeners: ((tenantId: string) => void)[] = [];
  private consumer: Consumer | undefined;

  constructor(private readonly options: TenantDirectoryOptions) {
    this.client = createGrpcClient(
      tenantV1.TenantServiceClient,
      options.address,
      options.channelCredentials ?? credentials.createInsecure(),
    );
  }

  async getProfile(tenantId: string): Promise<tenantV1.GetProfileResponse> {
    const key = profileCacheKey(tenantId);
    const cached = await this.options.redis.get(key);
    if (cached) {
      return tenantV1.GetProfileResponse.fromJSON(JSON.parse(cached));
    }
    const response = await this.inTenant(tenantId, () =>
      call<tenantV1.GetProfileRequest, tenantV1.GetProfileResponse>(
        this.client.getProfile.bind(this.client),
        {},
      ),
    );
    await this.options.redis.set(
      key,
      JSON.stringify(tenantV1.GetProfileResponse.toJSON(response)),
      'EX',
      this.options.profileTtlSeconds ?? PROFILE_CACHE_TTL_SECONDS,
    );
    return response;
  }

  async listAdapters(tenantId: string, partnerType: PartnerType): Promise<AdapterRecord[]> {
    const key = `${tenantId}:${partnerType}`;
    const cached = this.adapters.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.records;
    }
    const response = await this.inTenant(tenantId, () =>
      call<tenantV1.ResolveAdapterRequest, tenantV1.ResolveAdapterResponse>(
        this.client.resolveAdapter.bind(this.client),
        {
          partnerType: partnerTypeToProto(partnerType),
        },
      ),
    );
    const records = response.adapters.map((adapter) => ({
      partnerType,
      provider: adapter.provider,
      priority: adapter.priority,
      config: adapter.config ?? {},
      secretRef: adapter.secretRef || adapterSecretPath(tenantId, partnerType, adapter.provider),
    }));
    this.adapters.set(key, {
      records,
      expiresAt: Date.now() + (this.options.adapterTtlMs ?? ADAPTER_CACHE_TTL_MS),
    });
    return records;
  }

  onInvalidate(listener: (tenantId: string) => void): void {
    this.listeners.push(listener);
  }

  async invalidate(tenantId: string): Promise<void> {
    await this.options.redis.del(profileCacheKey(tenantId));
    for (const key of this.adapters.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.adapters.delete(key);
      }
    }
    for (const listener of this.listeners) {
      listener(tenantId);
    }
  }

  async startInvalidation(kafka: KafkaClient, groupId: string): Promise<void> {
    const consumer = kafka.consumer({
      kafkaJS: { groupId, fromBeginning: false, autoCommit: true },
    });
    this.consumer = consumer;
    await consumer.connect();
    await consumer.subscribe({ topics: [TENANCY_TOPIC] });
    await consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.headers?.tenantId;
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (value !== undefined) {
          await this.invalidate(value.toString());
        }
      },
    });
    const deadline = Date.now() + ASSIGNMENT_TIMEOUT_MS;
    while (consumer.assignment().length === 0) {
      if (Date.now() > deadline) {
        throw new Error('Tenancy invalidation consumer received no partition assignment');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async close(): Promise<void> {
    const consumer = this.consumer;
    this.consumer = undefined;
    await consumer?.disconnect();
    this.client.close();
  }

  private inTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithContext({ tenantId, requestId: newId(), locale: DEFAULT_LOCALE }, fn);
  }
}
