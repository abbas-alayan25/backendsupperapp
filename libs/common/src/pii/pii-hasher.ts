import { createHmac } from 'node:crypto';
import type { PiiKeyProvider } from './key-provider.js';
import { normalizeEmail, normalizePhone } from './normalize.js';

export class PiiHasher {
  constructor(private readonly keys: PiiKeyProvider) {}

  async hash(tenantId: string, value: string): Promise<string> {
    const key = await this.keys.hmacKey(tenantId);
    return createHmac('sha256', key).update(value, 'utf8').digest('hex');
  }

  hashPhone(tenantId: string, rawPhone: string): Promise<string> {
    return this.hash(tenantId, normalizePhone(rawPhone));
  }

  hashEmail(tenantId: string, rawEmail: string): Promise<string> {
    return this.hash(tenantId, normalizeEmail(rawEmail));
  }
}
