export const PARTNER_TYPES = [
  'BANK',
  'CARD_ISSUER',
  'KYC',
  'ACQUIRER',
  'BILLER',
  'SMS',
  'EMAIL',
  'PUSH',
] as const;

export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PARTNER_PATH: Readonly<Record<PartnerType, string>> = {
  BANK: 'bank',
  CARD_ISSUER: 'card-issuer',
  KYC: 'kyc',
  ACQUIRER: 'acquirer',
  BILLER: 'biller',
  SMS: 'sms',
  EMAIL: 'email',
  PUSH: 'push',
};

export interface AdapterMoney {
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface AdapterContext {
  readonly tenantId: string;
  readonly partnerType: PartnerType;
  readonly provider: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly secrets: Readonly<Record<string, string>>;
}

export interface ProbeResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail?: string;
}

export interface Probeable {
  probe(): Promise<ProbeResult>;
}

export interface WebhookEventBase {
  readonly partnerEventId: string;
  readonly sequence: number;
  readonly occurredAt: string;
}

export function adapterSecretPath(
  tenantId: string,
  partnerType: PartnerType,
  provider: string,
): string {
  return `tenants/${tenantId}/adapters/${PARTNER_PATH[partnerType]}/${provider}`;
}

export function isPartnerType(value: string): value is PartnerType {
  return (PARTNER_TYPES as readonly string[]).includes(value);
}
