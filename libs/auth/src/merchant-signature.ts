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

export function signingKeyFromApiKey(apiKey: string): string {
  return sha256Hex(apiKey);
}

export function canonicalSignatureString(input: SignatureInput): string {
  return [
    input.method.toUpperCase(),
    input.pathWithQuery,
    input.timestamp,
    sha256Hex(input.rawBody),
  ].join('\n');
}

export function signMerchantRequest(signingKey: string, input: SignatureInput): string {
  return hmacSha256Hex(signingKey, canonicalSignatureString(input));
}

export function verifyMerchantSignature(
  signingKey: string,
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
  const expected = signMerchantRequest(signingKey, input);
  return constantTimeEqualHex(expected, signature.toLowerCase())
    ? { valid: true }
    : { valid: false, reason: 'SIGNATURE_MISMATCH' };
}
