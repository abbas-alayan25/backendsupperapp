import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { AppError } from '../errors/app-error.js';

export type ProfileLocale = 'ar' | 'en';

export interface ProfileMoney {
  readonly amount: string;
  readonly currency: string;
}

export interface ProfileLimit {
  readonly service: 'P2P' | 'TOPUP' | 'WITHDRAWAL' | 'BILL' | 'QR' | 'CARD' | 'CASH_OUT' | 'ALL';
  readonly period: 'PER_TXN' | 'DAILY' | 'MONTHLY';
  readonly currency: string;
  readonly maxAmount?: string;
  readonly maxCount?: number;
}

export interface ProfileKycTier {
  readonly tier: number;
  readonly requiresTier?: number;
  readonly requiredFields: readonly string[];
  readonly requiredDocuments: readonly {
    readonly anyOf: readonly string[];
    readonly sides?: readonly string[];
  }[];
  readonly requiredChecks: readonly string[];
  readonly balanceCaps?: readonly ProfileMoney[];
  readonly limits: readonly ProfileLimit[];
}

export interface TenantProfileDocument {
  readonly brand: {
    readonly name: string;
    readonly themeTokens: string;
    readonly supportEmail: string;
    readonly supportPhone?: string;
    readonly privacyPolicyUrl?: string;
    readonly termsUrl?: string;
    readonly storeListing?: Readonly<Record<string, Readonly<Record<ProfileLocale, string>>>>;
  };
  readonly market: {
    readonly country: string;
    readonly currencies: readonly string[];
    readonly defaultCurrency: string;
    readonly locales: readonly ProfileLocale[];
    readonly defaultLocale: ProfileLocale;
    readonly timeZone: string;
    readonly phone: {
      readonly countryCallingCode: string;
      readonly nationalNumberPattern?: string;
    };
    readonly nationalIdPattern?: string;
  };
  readonly compliance: {
    readonly regulator: string;
    readonly kycTiers: readonly ProfileKycTier[];
    readonly cardIssuance: { readonly virtualMinTier: number; readonly physicalMinTier: number };
    readonly retentionYears: number;
    readonly screeningLists?: readonly string[];
    readonly newDeviceCooling?: {
      readonly hours: number;
      readonly outgoingThresholds: readonly ProfileMoney[];
    };
    readonly makerChecker: {
      readonly approvalExpiryHours: number;
      readonly thresholds: readonly {
        readonly actionType: string;
        readonly minApprovers: number;
        readonly amountThreshold?: ProfileMoney;
        readonly secondApproverAbove?: ProfileMoney;
      }[];
    };
  };
  readonly products: Readonly<
    Record<'wallet' | 'cards' | 'marketplace' | 'bills' | 'riders' | 'cashAgents', boolean>
  >;
  readonly adapters: {
    readonly bank?: readonly string[];
    readonly cardIssuer?: string;
    readonly kyc?: string;
    readonly acquirer?: string;
    readonly billers?: readonly string[];
    readonly sms?: string;
    readonly email?: string;
    readonly push?: string;
  };
  readonly deployment: {
    readonly model: 'SHARED' | 'DEDICATED';
    readonly region: string;
    readonly domain: string;
    readonly version: string;
  };
}

export interface ProfileIssue {
  readonly path: string;
  readonly message: string;
}

export type ProfileValidation =
  | { readonly valid: true; readonly profile: TenantProfileDocument }
  | { readonly valid: false; readonly issues: readonly ProfileIssue[] };

const schemaUrl = new URL('../../tenant-profile.schema.json', import.meta.url);

export const TENANT_PROFILE_SCHEMA: Readonly<Record<string, unknown>> = JSON.parse(
  readFileSync(schemaUrl, 'utf8'),
) as Record<string, unknown>;

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  strictTypes: false,
});
addFormats(ajv);
const validateSchema = ajv.compile<TenantProfileDocument>(TENANT_PROFILE_SCHEMA);

function semanticIssues(profile: TenantProfileDocument): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const currencies = new Set(profile.market.currencies);
  const checkCurrency = (currency: string, path: string) => {
    if (!currencies.has(currency)) {
      issues.push({ path, message: `currency ${currency} is not in market.currencies` });
    }
  };
  checkCurrency(profile.market.defaultCurrency, '/market/defaultCurrency');
  if (!profile.market.locales.includes(profile.market.defaultLocale)) {
    issues.push({
      path: '/market/defaultLocale',
      message: 'defaultLocale is not in market.locales',
    });
  }
  const tiers = profile.compliance.kycTiers.map((tier) => tier.tier);
  const expected = tiers.map((_, index) => index);
  if (
    new Set(tiers).size !== tiers.length ||
    [...tiers].sort((a, b) => a - b).some((tier, index) => tier !== expected[index])
  ) {
    issues.push({
      path: '/compliance/kycTiers',
      message: 'tiers must be unique and contiguous from 0',
    });
  }
  const tierSet = new Set(tiers);
  profile.compliance.kycTiers.forEach((tier, tierIndex) => {
    if (tier.requiresTier !== undefined && !tierSet.has(tier.requiresTier)) {
      issues.push({
        path: `/compliance/kycTiers/${String(tierIndex)}/requiresTier`,
        message: 'unknown tier',
      });
    }
    tier.limits.forEach((limit, limitIndex) => {
      checkCurrency(
        limit.currency,
        `/compliance/kycTiers/${String(tierIndex)}/limits/${String(limitIndex)}/currency`,
      );
    });
    tier.balanceCaps?.forEach((cap, capIndex) => {
      checkCurrency(
        cap.currency,
        `/compliance/kycTiers/${String(tierIndex)}/balanceCaps/${String(capIndex)}/currency`,
      );
    });
  });
  for (const key of ['virtualMinTier', 'physicalMinTier'] as const) {
    if (!tierSet.has(profile.compliance.cardIssuance[key])) {
      issues.push({
        path: `/compliance/cardIssuance/${key}`,
        message: 'tier is not defined in kycTiers',
      });
    }
  }
  profile.compliance.newDeviceCooling?.outgoingThresholds.forEach((threshold, index) => {
    checkCurrency(
      threshold.currency,
      `/compliance/newDeviceCooling/outgoingThresholds/${String(index)}/currency`,
    );
  });
  profile.compliance.makerChecker.thresholds.forEach((threshold, index) => {
    for (const key of ['amountThreshold', 'secondApproverAbove'] as const) {
      const money = threshold[key];
      if (money) {
        checkCurrency(
          money.currency,
          `/compliance/makerChecker/thresholds/${String(index)}/${key}/currency`,
        );
      }
    }
  });
  return issues;
}

export function validateTenantProfile(document: unknown): ProfileValidation {
  if (!validateSchema(document)) {
    return {
      valid: false,
      issues: (validateSchema.errors ?? []).map((error) => ({
        path: error.instancePath || '/',
        message: error.message ?? 'invalid',
      })),
    };
  }
  const issues = semanticIssues(document);
  return issues.length === 0 ? { valid: true, profile: document } : { valid: false, issues };
}

export function assertTenantProfile(document: unknown): TenantProfileDocument {
  const result = validateTenantProfile(document);
  if (!result.valid) {
    throw new AppError('VALIDATION_FAILED', {
      reason: 'INVALID_TENANT_PROFILE',
      issues: result.issues,
    });
  }
  return result.profile;
}
