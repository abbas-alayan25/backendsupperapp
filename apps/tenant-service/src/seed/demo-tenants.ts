import { TENANT_PROFILE_SCHEMA, type TenantProfileDocument } from '@super-app/common';

export interface DemoTenantSeed {
  readonly id: string;
  readonly code: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly country: string;
  readonly profile: TenantProfileDocument;
  readonly extraDomains: readonly { readonly domain: string; readonly kind: 'ADMIN' | 'MERCHANT' | 'WEB' }[];
}

const examples = TENANT_PROFILE_SCHEMA.examples as readonly TenantProfileDocument[];
const acmeProfile = examples[0];
if (!acmeProfile) {
  throw new Error('tenant-profile.schema.json has no example profile');
}

const petraProfile: TenantProfileDocument = {
  brand: {
    name: 'Petra Wallet',
    themeTokens: 's3://brand/petra/tokens.json',
    supportEmail: 'support@petrawallet.example',
    supportPhone: '+96261234567',
  },
  market: {
    country: 'JO',
    currencies: ['JOD'],
    defaultCurrency: 'JOD',
    locales: ['ar', 'en'],
    defaultLocale: 'ar',
    timeZone: 'Asia/Amman',
    phone: { countryCallingCode: '+962' },
  },
  compliance: {
    regulator: 'central-bank-jo',
    kycTiers: [
      {
        tier: 0,
        requiredFields: [],
        requiredDocuments: [],
        requiredChecks: [],
        balanceCaps: [{ amount: '150.000', currency: 'JOD' }],
        limits: [{ service: 'TOPUP', period: 'DAILY', currency: 'JOD', maxAmount: '150.000' }],
      },
      {
        tier: 1,
        requiresTier: 0,
        requiredFields: ['FULL_NAME', 'DOB', 'ID_NUMBER'],
        requiredDocuments: [{ anyOf: ['NATIONAL_ID'], sides: ['FRONT', 'BACK'] }, { anyOf: ['SELFIE'] }],
        requiredChecks: ['OCR', 'AUTHENTICITY', 'LIVENESS', 'FACE_MATCH', 'SANCTIONS', 'PEP'],
        limits: [
          { service: 'P2P', period: 'DAILY', currency: 'JOD', maxAmount: '700.000', maxCount: 15 },
          { service: 'ALL', period: 'MONTHLY', currency: 'JOD', maxAmount: '3500.000' },
        ],
      },
    ],
    cardIssuance: { virtualMinTier: 1, physicalMinTier: 1 },
    retentionYears: 10,
    screeningLists: ['UN', 'LOCAL'],
    makerChecker: {
      approvalExpiryHours: 48,
      thresholds: [
        { actionType: 'users.freeze', minApprovers: 1 },
        {
          actionType: 'transactions.refund',
          minApprovers: 1,
          amountThreshold: { amount: '300.000', currency: 'JOD' },
        },
      ],
    },
  },
  products: { wallet: true, cards: false, marketplace: true, bills: true, riders: true, cashAgents: true },
  adapters: {
    bank: ['bank-sim-c'],
    kyc: 'kyc-sim-local',
    acquirer: 'acquirer-sim',
    billers: ['biller-sim-local'],
    sms: 'sms-sim-local',
    push: 'push-sim',
  },
  deployment: { model: 'SHARED', region: 'me-central-1', domain: 'api.petrawallet.example', version: '2026.10.1' },
};

export const DEMO_TENANT_SEEDS: readonly DemoTenantSeed[] = [
  {
    id: '01928b4e-7a00-7000-8000-000000000001',
    code: 'acme-lb',
    legalName: 'Acme Payments SAL',
    displayName: 'Acme Pay',
    country: 'LB',
    profile: acmeProfile,
    extraDomains: [{ domain: 'admin.acmepay.example', kind: 'ADMIN' }],
  },
  {
    id: '01928b4e-7a00-7000-8000-000000000002',
    code: 'petra-jo',
    legalName: 'Petra Wallet PSC',
    displayName: 'Petra Wallet',
    country: 'JO',
    profile: petraProfile,
    extraDomains: [{ domain: 'admin.petrawallet.example', kind: 'ADMIN' }],
  },
];
