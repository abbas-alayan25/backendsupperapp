import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const EMPTY_BODY_SHA256 = createHash('sha256').update('').digest('hex');

export function sha256Hex(value: Buffer | string | undefined): string {
  return createHash('sha256')
    .update(value ?? '')
    .digest('hex');
}

export function stepUpRequestHash(
  method: string,
  pathWithQuery: string,
  rawBody: Buffer | string | undefined,
): string {
  return sha256Hex(`${method.toUpperCase()}\n${pathWithQuery}\n${sha256Hex(rawBody)}`);
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function hmacSha256Hex(key: Buffer | string, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}
