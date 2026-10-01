export type PartnerPath =
  'bank' | 'card-issuer' | 'kyc' | 'acquirer' | 'biller' | 'sms' | 'email' | 'push';

export interface DemoAdapter {
  readonly partnerType: PartnerPath;
  readonly provider: string;
}

export interface DemoTenant {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly country: string;
  readonly currencies: readonly string[];
  readonly locales: readonly string[];
  readonly timeZone: string;
  readonly adapters: readonly DemoAdapter[];
}

export const DEMO_TENANTS: readonly DemoTenant[] = [
  {
    id: '01928b4e-7a00-7000-8000-000000000001',
    code: 'acme-lb',
    displayName: 'Acme Pay',
    country: 'LB',
    currencies: ['USD', 'LBP'],
    locales: ['ar', 'en'],
    timeZone: 'Asia/Beirut',
    adapters: [
      { partnerType: 'bank', provider: 'bank-sim-a' },
      { partnerType: 'bank', provider: 'bank-sim-b' },
      { partnerType: 'card-issuer', provider: 'card-sim' },
      { partnerType: 'kyc', provider: 'kyc-sim' },
      { partnerType: 'acquirer', provider: 'acquirer-sim' },
      { partnerType: 'biller', provider: 'biller-sim' },
      { partnerType: 'sms', provider: 'sms-sim' },
      { partnerType: 'email', provider: 'email-sim' },
      { partnerType: 'push', provider: 'push-sim' },
    ],
  },
  {
    id: '01928b4e-7a00-7000-8000-000000000002',
    code: 'petra-jo',
    displayName: 'Petra Wallet',
    country: 'JO',
    currencies: ['JOD'],
    locales: ['ar', 'en'],
    timeZone: 'Asia/Amman',
    adapters: [
      { partnerType: 'bank', provider: 'bank-sim-c' },
      { partnerType: 'kyc', provider: 'kyc-sim-local' },
      { partnerType: 'acquirer', provider: 'acquirer-sim' },
      { partnerType: 'biller', provider: 'biller-sim-local' },
      { partnerType: 'sms', provider: 'sms-sim-local' },
      { partnerType: 'push', provider: 'push-sim' },
    ],
  },
];

export function adapterSecretPath(tenantId: string, adapter: DemoAdapter): string {
  return `tenants/${tenantId}/adapters/${adapter.partnerType}/${adapter.provider}`;
}

export function tenantTransitKey(tenantId: string): string {
  return `tenant-${tenantId}`;
}
