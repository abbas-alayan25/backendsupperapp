import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors/app-error.js';

export type CursorPayload = Readonly<Record<string, string | number | boolean | null>>;

function invalidCursor(): AppError {
  return new AppError('VALIDATION_FAILED', { field: 'cursor', reason: 'INVALID_CURSOR' });
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) => entry === null || ['string', 'number', 'boolean'].includes(typeof entry),
  );
}

export class CursorCodec {
  private readonly secret: Buffer;

  constructor(secret: string | Uint8Array) {
    this.secret = Buffer.from(secret);
    if (this.secret.length < 32) {
      throw new RangeError('Cursor secret must be at least 32 bytes');
    }
  }

  encode(payload: CursorPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body).toString('base64url')}`;
  }

  decode(cursor: string): CursorPayload {
    const [body, signature, ...rest] = cursor.split('.');
    if (!body || !signature || rest.length > 0) {
      throw invalidCursor();
    }
    const expected = this.sign(body);
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw invalidCursor();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw invalidCursor();
    }
    if (!isCursorPayload(parsed)) {
      throw invalidCursor();
    }
    return parsed;
  }

  private sign(body: string): Buffer {
    return createHmac('sha256', this.secret).update(body).digest();
  }
}
