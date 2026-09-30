import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PiiKeyProvider } from './key-provider.js';

const FORMAT_VERSION = 1;
const HEADER_LENGTH = 5;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

export class PiiDecryptionError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`PII decryption failed: ${reason}`, options);
    this.name = 'PiiDecryptionError';
  }
}

export class PiiCipher {
  constructor(private readonly keys: PiiKeyProvider) {}

  async encrypt(tenantId: string, plaintext: string): Promise<Buffer> {
    const { version, key } = await this.keys.currentDataKey(tenantId);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    cipher.setAAD(Buffer.from(tenantId));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const header = Buffer.alloc(HEADER_LENGTH);
    header.writeUInt8(FORMAT_VERSION, 0);
    header.writeUInt32BE(version, 1);
    return Buffer.concat([header, iv, ciphertext, cipher.getAuthTag()]);
  }

  async decrypt(tenantId: string, blob: Uint8Array): Promise<string> {
    const data = Buffer.from(blob);
    if (data.length < HEADER_LENGTH + IV_LENGTH + TAG_LENGTH) {
      throw new PiiDecryptionError('blob too short');
    }
    if (data.readUInt8(0) !== FORMAT_VERSION) {
      throw new PiiDecryptionError('unknown format version');
    }
    const key = await this.keys.dataKey(tenantId, data.readUInt32BE(1));
    const iv = data.subarray(HEADER_LENGTH, HEADER_LENGTH + IV_LENGTH);
    const tag = data.subarray(data.length - TAG_LENGTH);
    const ciphertext = data.subarray(HEADER_LENGTH + IV_LENGTH, data.length - TAG_LENGTH);
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
      decipher.setAAD(Buffer.from(tenantId));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (cause) {
      throw new PiiDecryptionError('authentication failed', { cause });
    }
  }
}
