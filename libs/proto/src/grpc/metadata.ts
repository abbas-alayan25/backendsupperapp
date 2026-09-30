export const TENANT_ID_METADATA = 'tenant-id';
export const REQUEST_ID_METADATA = 'request-id';
export const TRACEPARENT_METADATA = 'traceparent';
export const IDEMPOTENCY_KEY_METADATA = 'idempotency-key';
export const ERROR_CODE_METADATA = 'error-code';
export const ERROR_DETAILS_METADATA = 'error-details';

export const DEFAULT_DEADLINE_MS = 2_000;

export const SERVICE_DEADLINES_MS: Readonly<Record<string, number>> = {
  'ledger.v1.LedgerService': 300,
  'risk.v1.RiskService': 300,
};

export function deadlineFor(serviceName: string): number {
  return SERVICE_DEADLINES_MS[serviceName] ?? DEFAULT_DEADLINE_MS;
}
