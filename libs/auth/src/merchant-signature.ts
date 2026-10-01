import { constantTimeEqualHex, hmacSha256Hex, sha256Hex } from './hashing.js';

export const SIGNATURE_MAX_SKEW_SECONDS = 300;

export interface SignatureInput {
  readonly method: string;
  readonly pathWithQuery: string;
  readonly timestamp: string;
  readonly rawBody: Buffer | string | undefined;
}

export type SignatureCheck =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason: 'TIMESTAMP_INVALID' | 'TIMESTAMP_SKEW' | 'SIGNATURE_MISMATCH';
    };

export function canonicalSignatureString(input: SignatureInput): string {
  return [
    input.method.toUpperCase(),
    input.pathWithQuery,
    input.timestamp,
    sha256Hex(input.rawBody),
  ].join('\n');
}

export function signMerchantRequest(secret: string, input: SignatureInput): string {
  return hmacSha256Hex(secret, canonicalSignatureString(input));
}

export function verifyMerchantSignature(
  secrets: string | readonly string[],
  input: SignatureInput,
  signature: string,
  now: Date = new Date(),
): SignatureCheck {
  if (!/^\d{10}$/.test(input.timestamp)) {
    return { valid: false, reason: 'TIMESTAMP_INVALID' };
  }
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(input.timestamp));
  if (skew > SIGNATURE_MAX_SKEW_SECONDS) {
    return { valid: false, reason: 'TIMESTAMP_SKEW' };
  }
  const candidates = typeof secrets === 'string' ? [secrets] : secrets;
  const provided = signature.toLowerCase();
  const matched = candidates.some((secret) =>
    constantTimeEqualHex(signMerchantRequest(secret, input), provided),
  );
  return matched ? { valid: true } : { valid: false, reason: 'SIGNATURE_MISMATCH' };
}
