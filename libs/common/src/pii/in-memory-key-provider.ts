import { hkdfSync } from 'node:crypto';
import { type PiiKeyProvider, PiiKeyNotFoundError, type TenantDataKey } from './key-provider.js';

const KEY_LENGTH = 32;

function derive(masterSecret: Uint8Array, info: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', masterSecret, new Uint8Array(0), info, KEY_LENGTH));
}

export class InMemoryPiiKeyProvider implements PiiKeyProvider {
  private readonly masterSecret: Uint8Array;
  private readonly currentVersions = new Map<string, number>();

  constructor(masterSecret: string | Uint8Array) {
    this.masterSecret = typeof masterSecret === 'string' ? Buffer.from(masterSecret) : masterSecret;
    if (this.masterSecret.length < KEY_LENGTH) {
      throw new RangeError('PII master secret must be at least 32 bytes');
    }
  }

  currentDataKey(tenantId: string): Promise<TenantDataKey> {
    const version = this.currentVersions.get(tenantId) ?? 1;
    return Promise.resolve({ version, key: this.deriveDataKey(tenantId, version) });
  }

  dataKey(tenantId: string, version: number): Promise<Uint8Array> {
    const current = this.currentVersions.get(tenantId) ?? 1;
    if (!Number.isInteger(version) || version < 1 || version > current) {
      return Promise.reject(new PiiKeyNotFoundError(tenantId, version));
    }
    return Promise.resolve(this.deriveDataKey(tenantId, version));
  }

  hmacKey(tenantId: string): Promise<Uint8Array> {
    return Promise.resolve(derive(this.masterSecret, `pii-hmac:${tenantId}`));
  }

  rotateDataKey(tenantId: string): number {
    const next = (this.currentVersions.get(tenantId) ?? 1) + 1;
    this.currentVersions.set(tenantId, next);
    return next;
  }

  private deriveDataKey(tenantId: string, version: number): Uint8Array {
    return derive(this.masterSecret, `pii-data:${tenantId}:${String(version)}`);
  }
}
