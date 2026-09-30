export interface TenantDataKey {
  readonly version: number;
  readonly key: Uint8Array;
}

export interface PiiKeyProvider {
  currentDataKey(tenantId: string): Promise<TenantDataKey>;
  dataKey(tenantId: string, version: number): Promise<Uint8Array>;
  hmacKey(tenantId: string): Promise<Uint8Array>;
}

export class PiiKeyNotFoundError extends Error {
  constructor(tenantId: string, version?: number) {
    super(
      version === undefined
        ? `No PII key for tenant ${tenantId}`
        : `No PII key version ${String(version)} for tenant ${tenantId}`,
    );
    this.name = 'PiiKeyNotFoundError';
  }
}
