import {
  createTableSql,
  globalTableGrantsSql,
  qualified,
  schemaRoles,
  schemaSetupSql,
  stdTablesSql,
  updatedAtTriggerSql,
} from '@super-app/db';

export const TENANCY_SCHEMA = 'tenancy';

export const TENANT_STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED'] as const;
export const DEPLOYMENT_MODELS = ['SHARED', 'DEDICATED'] as const;
export const PROFILE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export const ADAPTER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export const DOMAIN_KINDS = ['API', 'ADMIN', 'MERCHANT', 'WEB'] as const;
export const DEPLOYMENT_ENVIRONMENTS = ['STAGING', 'PROD'] as const;
export const APP_TYPES = ['CONSUMER', 'MERCHANT', 'RIDER'] as const;
export const APP_PLATFORMS = ['IOS', 'ANDROID'] as const;
export const PARTNER_TYPE_VALUES = [
  'BANK',
  'CARD_ISSUER',
  'KYC',
  'ACQUIRER',
  'BILLER',
  'SMS',
  'EMAIL',
  'PUSH',
] as const;

function check(column: string, values: readonly string[]): string {
  return `CHECK (${column} IN (${values.map((value) => `'${value}'`).join(', ')}))`;
}

function tenantForeignKey(): string {
  return `FOREIGN KEY (tenant_id) REFERENCES ${qualified(TENANCY_SCHEMA, 'tenants')} (id)`;
}

function tenantsTableSql(): string {
  const target = qualified(TENANCY_SCHEMA, 'tenants');
  return [
    `CREATE TABLE ${target} (
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 0,
  code text NOT NULL,
  legal_name text NOT NULL,
  display_name text NOT NULL,
  country char(2) NOT NULL,
  status text NOT NULL ${check('status', TENANT_STATUSES)},
  deployment_model text NOT NULL ${check('deployment_model', DEPLOYMENT_MODELS)},
  region text NOT NULL,
  current_profile_version int,
  PRIMARY KEY (id),
  CONSTRAINT tenants_code_key UNIQUE (code)
);`,
    globalTableGrantsSql(TENANCY_SCHEMA, 'tenants'),
    updatedAtTriggerSql(TENANCY_SCHEMA, 'tenants'),
  ].join('\n');
}

export function tenancyMigrationSql(): string {
  const schema = TENANCY_SCHEMA;
  const roles = schemaRoles(schema);
  return [
    schemaSetupSql(schema),
    `GRANT ${roles.app} TO ${roles.sync};`,
    tenantsTableSql(),
    createTableSql({
      schema,
      table: 'tenant_profiles',
      kind: 'mutable',
      columns: [
        'profile_version int NOT NULL CHECK (profile_version > 0)',
        'brand jsonb NOT NULL',
        'market jsonb NOT NULL',
        'compliance jsonb NOT NULL',
        'products jsonb NOT NULL',
        'fees_ref text',
        `status text NOT NULL ${check('status', PROFILE_STATUSES)}`,
        'approved_by uuid',
        'activated_at timestamptz',
      ],
      constraints: [
        'CONSTRAINT tenant_profiles_tenant_id_profile_version_key UNIQUE (tenant_id, profile_version)',
        `CONSTRAINT tenant_profiles_tenant_id_fkey ${tenantForeignKey()}`,
      ],
    }),
    createTableSql({
      schema,
      table: 'tenant_adapters',
      kind: 'mutable',
      columns: [
        `partner_type text NOT NULL ${check('partner_type', PARTNER_TYPE_VALUES)}`,
        'provider text NOT NULL',
        'priority int NOT NULL',
        "config jsonb NOT NULL DEFAULT '{}'::jsonb",
        'secret_ref text NOT NULL',
        `status text NOT NULL ${check('status', ADAPTER_STATUSES)}`,
      ],
      constraints: [
        'CONSTRAINT tenant_adapters_tenant_id_partner_type_provider_key UNIQUE (tenant_id, partner_type, provider)',
        `CONSTRAINT tenant_adapters_tenant_id_fkey ${tenantForeignKey()}`,
      ],
    }),
    createTableSql({
      schema,
      table: 'tenant_domains',
      kind: 'mutable',
      columns: [
        'domain text NOT NULL',
        `kind text NOT NULL ${check('kind', DOMAIN_KINDS)}`,
        "tls_status text NOT NULL DEFAULT 'PENDING'",
      ],
      constraints: [
        'CONSTRAINT tenant_domains_domain_key UNIQUE (domain)',
        `CONSTRAINT tenant_domains_tenant_id_fkey ${tenantForeignKey()}`,
      ],
    }),
    `GRANT DELETE ON ${qualified(schema, 'tenant_domains')} TO ${roles.sync};`,
    createTableSql({
      schema,
      table: 'tenant_deployments',
      kind: 'mutable',
      columns: [
        `environment text NOT NULL ${check('environment', DEPLOYMENT_ENVIRONMENTS)}`,
        'cluster text NOT NULL',
        'region text NOT NULL',
        'app_version text NOT NULL',
        'helm_values_ref text',
        'status text NOT NULL',
        'deployed_at timestamptz',
      ],
      constraints: [`CONSTRAINT tenant_deployments_tenant_id_fkey ${tenantForeignKey()}`],
      indexes: [
        `CREATE INDEX tenant_deployments_tenant_id_environment_idx ON ${qualified(schema, 'tenant_deployments')} (tenant_id, environment)`,
      ],
    }),
    createTableSql({
      schema,
      table: 'tenant_apps',
      kind: 'mutable',
      columns: [
        `app_type text NOT NULL ${check('app_type', APP_TYPES)}`,
        `platform text NOT NULL ${check('platform', APP_PLATFORMS)}`,
        'bundle_id text NOT NULL',
        'store_account_ref text',
        'min_supported_version text NOT NULL',
        'latest_version text NOT NULL',
      ],
      constraints: [
        'CONSTRAINT tenant_apps_tenant_id_app_type_platform_key UNIQUE (tenant_id, app_type, platform)',
        `CONSTRAINT tenant_apps_tenant_id_fkey ${tenantForeignKey()}`,
      ],
    }),
    createTableSql({
      schema,
      table: 'tenant_usage_daily',
      kind: 'mutable',
      columns: [
        'usage_date date NOT NULL',
        'active_users int NOT NULL DEFAULT 0',
        'txn_count int NOT NULL DEFAULT 0',
        'txn_volume_minor bigint NOT NULL DEFAULT 0',
        'currency char(3) NOT NULL',
      ],
      constraints: [
        'CONSTRAINT tenant_usage_daily_tenant_id_usage_date_currency_key UNIQUE (tenant_id, usage_date, currency)',
        `CONSTRAINT tenant_usage_daily_tenant_id_fkey ${tenantForeignKey()}`,
      ],
    }),
    stdTablesSql(schema),
  ].join('\n\n');
}
