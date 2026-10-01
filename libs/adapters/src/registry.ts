import { AppError } from '@super-app/common';
import type { AcquirerAdapter } from './interfaces/acquirer.js';
import type { BankAdapter } from './interfaces/bank.js';
import type { BillerAdapter } from './interfaces/biller.js';
import type { CardIssuerAdapter } from './interfaces/card-issuer.js';
import type { KycProviderAdapter } from './interfaces/kyc.js';
import type { MessagingAdapter } from './interfaces/messaging.js';
import { type AdapterContext, type PartnerType, adapterSecretPath } from './types.js';

export interface AdapterOf {
  BANK: BankAdapter;
  CARD_ISSUER: CardIssuerAdapter;
  KYC: KycProviderAdapter;
  ACQUIRER: AcquirerAdapter;
  BILLER: BillerAdapter;
  SMS: MessagingAdapter;
  EMAIL: MessagingAdapter;
  PUSH: MessagingAdapter;
}

export interface AdapterDefinition<P extends PartnerType = PartnerType> {
  readonly partnerType: P;
  readonly provider: string;
  readonly description: string;
  readonly configSchema: Readonly<Record<string, unknown>>;
  create(context: AdapterContext): AdapterOf[P];
}

export interface AdapterRecord {
  readonly partnerType: PartnerType;
  readonly provider: string;
  readonly priority: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly secretRef: string;
}

export interface AdapterSource {
  listAdapters(tenantId: string, partnerType: PartnerType): Promise<AdapterRecord[]>;
}

export interface SecretSource {
  readKv(path: string): Promise<Record<string, string> | undefined>;
}

export interface CatalogEntry {
  readonly partnerType: PartnerType;
  readonly provider: string;
  readonly description: string;
  readonly configSchema: Readonly<Record<string, unknown>>;
}

interface CachedInstance {
  readonly adapter: unknown;
  readonly expiresAt: number;
}

export class AdapterRegistry {
  private readonly definitions = new Map<string, AdapterDefinition>();
  private readonly instances = new Map<string, CachedInstance>();

  constructor(
    private readonly source: AdapterSource,
    private readonly secrets: SecretSource,
    private readonly ttlMs = 300_000,
    private readonly now: () => number = Date.now,
  ) {}

  register<P extends PartnerType>(definition: AdapterDefinition<P>): this {
    const key = `${definition.partnerType}:${definition.provider}`;
    if (this.definitions.has(key)) {
      throw new RangeError(`Adapter ${key} is already registered`);
    }
    this.definitions.set(key, definition);
    return this;
  }

  has(partnerType: PartnerType, provider: string): boolean {
    return this.definitions.has(`${partnerType}:${provider}`);
  }

  catalog(): CatalogEntry[] {
    return [...this.definitions.values()]
      .map(({ partnerType, provider, description, configSchema }) => ({
        partnerType,
        provider,
        description,
        configSchema,
      }))
      .sort(
        (a, b) =>
          a.partnerType.localeCompare(b.partnerType) || a.provider.localeCompare(b.provider),
      );
  }

  async resolveAll<P extends PartnerType>(
    tenantId: string,
    partnerType: P,
  ): Promise<AdapterOf[P][]> {
    const records = (await this.source.listAdapters(tenantId, partnerType))
      .filter((record) => record.partnerType === partnerType)
      .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider));
    return Promise.all(records.map((record) => this.build<P>(tenantId, record)));
  }

  async resolve<P extends PartnerType>(tenantId: string, partnerType: P): Promise<AdapterOf[P]> {
    const [first] = await this.resolveAll(tenantId, partnerType);
    if (!first) {
      throw new AppError('SERVICE_DISABLED', { reason: 'NO_ADAPTER', partnerType });
    }
    return first;
  }

  async build<P extends PartnerType>(
    tenantId: string,
    record: AdapterRecord,
  ): Promise<AdapterOf[P]> {
    const key = `${tenantId}:${record.partnerType}:${record.provider}`;
    const cached = this.instances.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.adapter as AdapterOf[P];
    }
    const definition = this.definitions.get(`${record.partnerType}:${record.provider}`);
    if (!definition) {
      throw new AppError('PARTNER_UNAVAILABLE', {
        reason: 'UNKNOWN_PROVIDER',
        provider: record.provider,
      });
    }
    const expectedPath = adapterSecretPath(tenantId, record.partnerType, record.provider);
    if (record.secretRef !== expectedPath) {
      throw new AppError('FORBIDDEN', {
        reason: 'SECRET_PATH_NOT_TENANT_SCOPED',
        provider: record.provider,
      });
    }
    const secrets = await this.secrets.readKv(record.secretRef);
    if (!secrets) {
      throw new AppError('PARTNER_UNAVAILABLE', {
        reason: 'SECRETS_MISSING',
        provider: record.provider,
      });
    }
    const adapter = definition.create({
      tenantId,
      partnerType: record.partnerType,
      provider: record.provider,
      config: record.config,
      secrets,
    });
    this.instances.set(key, { adapter, expiresAt: this.now() + this.ttlMs });
    return adapter as AdapterOf[P];
  }

  invalidate(tenantId: string): void {
    for (const key of this.instances.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.instances.delete(key);
      }
    }
  }
}
