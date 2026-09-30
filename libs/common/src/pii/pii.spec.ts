import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { InMemoryPiiKeyProvider } from './in-memory-key-provider.js';
import { PiiKeyNotFoundError } from './key-provider.js';
import { normalizeEmail, normalizePhone } from './normalize.js';
import { PiiCipher, PiiDecryptionError } from './pii-cipher.js';
import { PiiHasher } from './pii-hasher.js';

const MASTER = 'local-master-secret-local-master-secret';
const TENANT_A = '01920000-0000-7000-8000-00000000000a';
const TENANT_B = '01920000-0000-7000-8000-00000000000b';

function setup() {
  const keys = new InMemoryPiiKeyProvider(MASTER);
  return { keys, cipher: new PiiCipher(keys), hasher: new PiiHasher(keys) };
}

describe('PiiCipher', () => {
  it('round-trips unicode plaintext', async () => {
    const { cipher } = setup();
    const blob = await cipher.encrypt(TENANT_A, 'عبد الله +962791234567');
    expect(await cipher.decrypt(TENANT_A, blob)).toBe('عبد الله +962791234567');
  });

  it('uses a fresh IV for every encryption', async () => {
    const { cipher } = setup();
    const first = await cipher.encrypt(TENANT_A, 'same');
    const second = await cipher.encrypt(TENANT_A, 'same');
    expect(first.equals(second)).toBe(false);
  });

  it('writes the format and key version header', async () => {
    const { cipher } = setup();
    const blob = await cipher.encrypt(TENANT_A, 'x');
    expect(blob.readUInt8(0)).toBe(1);
    expect(blob.readUInt32BE(1)).toBe(1);
  });

  it('cannot be decrypted as another tenant', async () => {
    const { cipher } = setup();
    const blob = await cipher.encrypt(TENANT_A, 'secret');
    await expect(cipher.decrypt(TENANT_B, blob)).rejects.toBeInstanceOf(PiiDecryptionError);
  });

  it('detects tampering', async () => {
    const { cipher } = setup();
    const blob = await cipher.encrypt(TENANT_A, 'secret');
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 20] = (tampered[tampered.length - 20] ?? 0) ^ 0xff;
    await expect(cipher.decrypt(TENANT_A, tampered)).rejects.toBeInstanceOf(PiiDecryptionError);
  });

  it('rejects truncated and unknown-format blobs', async () => {
    const { cipher } = setup();
    await expect(cipher.decrypt(TENANT_A, Buffer.alloc(10))).rejects.toBeInstanceOf(
      PiiDecryptionError,
    );
    const blob = await cipher.encrypt(TENANT_A, 'secret');
    blob.writeUInt8(9, 0);
    await expect(cipher.decrypt(TENANT_A, blob)).rejects.toBeInstanceOf(PiiDecryptionError);
  });

  it('still decrypts old blobs after key rotation and encrypts with the new version', async () => {
    const { keys, cipher } = setup();
    const before = await cipher.encrypt(TENANT_A, 'old');
    expect(keys.rotateDataKey(TENANT_A)).toBe(2);
    const after = await cipher.encrypt(TENANT_A, 'new');
    expect(after.readUInt32BE(1)).toBe(2);
    expect(await cipher.decrypt(TENANT_A, before)).toBe('old');
    expect(await cipher.decrypt(TENANT_A, after)).toBe('new');
  });

  it('refuses unknown key versions', async () => {
    const { cipher } = setup();
    const blob = await cipher.encrypt(TENANT_A, 'secret');
    blob.writeUInt32BE(7, 1);
    await expect(cipher.decrypt(TENANT_A, blob)).rejects.toBeInstanceOf(PiiKeyNotFoundError);
  });

  it('requires a strong master secret', () => {
    expect(() => new InMemoryPiiKeyProvider('short')).toThrow(RangeError);
  });
});

describe('PiiHasher', () => {
  it('is deterministic per tenant and differs across tenants', async () => {
    const { hasher } = setup();
    const a1 = await hasher.hash(TENANT_A, 'value');
    const a2 = await hasher.hash(TENANT_A, 'value');
    const b = await hasher.hash(TENANT_B, 'value');
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it('hashes equivalent phone numbers identically', async () => {
    const { hasher } = setup();
    const variants = ['+962 79 123 4567', '00962791234567', '+962-79-123-4567', '+٩٦٢٧٩١٢٣٤٥٦٧'];
    const hashes = await Promise.all(variants.map((v) => hasher.hashPhone(TENANT_A, v)));
    expect(new Set(hashes).size).toBe(1);
  });

  it('hashes equivalent emails identically', async () => {
    const { hasher } = setup();
    const first = await hasher.hashEmail(TENANT_A, ' User@Example.COM ');
    const second = await hasher.hashEmail(TENANT_A, 'user@example.com');
    expect(first).toBe(second);
  });
});

describe('normalization', () => {
  it('normalizes phones to E.164', () => {
    expect(normalizePhone('(+962) 79.123.4567')).toBe('+962791234567');
    expect(normalizePhone('۰۰۹۶۲۷۹۱۲۳۴۵۶۷')).toBe('+962791234567');
  });

  it.each(['0791234567', '+0791234567', '+12', 'phone', '+9627912345678901'])(
    'rejects phone %j',
    (value) => {
      expect(() => normalizePhone(value)).toThrow(AppError);
    },
  );

  it.each(['no-at-sign', 'a@b', 'a b@c.com', ''])('rejects email %j', (value) => {
    expect(() => normalizeEmail(value)).toThrow(AppError);
  });
});
