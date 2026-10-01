import { type PartnerType, adapterSecretPath } from '@super-app/adapters';
import { AppError, type TenantProfileDocument, assertTenantProfile } from '@super-app/common';

export type ProfileBlocks = Pick<TenantProfileDocument, 'brand' | 'market' | 'compliance' | 'products'>;
export type ProjectionBlocks = Pick<TenantProfileDocument, 'adapters' | 'deployment'>;

export interface DesiredAdapter {
  readonly partnerType: PartnerType;
  readonly provider: string;
  readonly priority: number;
  readonly secretRef: string;
}

const SINGLE_ADAPTERS = [
  ['cardIssuer', 'CARD_ISSUER'],
  ['kyc', 'KYC'],
  ['acquirer', 'ACQUIRER'],
  ['sms', 'SMS'],
  ['email', 'EMAIL'],
  ['push', 'PUSH'],
] as const;

const LIST_ADAPTERS = [
  ['bank', 'BANK'],
  ['billers', 'BILLER'],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function splitDraftDocument(document: unknown): ProfileBlocks {
  const profile = assertTenantProfile(document);
  return {
    brand: profile.brand,
    market: profile.market,
    compliance: profile.compliance,
    products: profile.products,
  };
}

export function composeDocument(blocks: ProfileBlocks, projection: unknown): TenantProfileDocument {
  if (!isRecord(projection)) {
    throw new AppError('VALIDATION_FAILED', { reason: 'ACTIVATION_BODY_INVALID' });
  }
  return assertTenantProfile({
    ...blocks,
    adapters: projection.adapters,
    deployment: projection.deployment,
  });
}

export function desiredAdapters(tenantId: string, adapters: TenantProfileDocument['adapters']): DesiredAdapter[] {
  const desired: DesiredAdapter[] = [];
  for (const [key, partnerType] of LIST_ADAPTERS) {
    (adapters[key] ?? []).forEach((provider, index) => {
      desired.push({ partnerType, provider, priority: index + 1, secretRef: adapterSecretPath(tenantId, partnerType, provider) });
    });
  }
  for (const [key, partnerType] of SINGLE_ADAPTERS) {
    const provider = adapters[key];
    if (provider !== undefined) {
      desired.push({ partnerType, provider, priority: 1, secretRef: adapterSecretPath(tenantId, partnerType, provider) });
    }
  }
  return desired;
}
