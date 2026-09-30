import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { CursorCodec } from './cursor-codec.js';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, parseLimit } from './limit.js';
import { toPage } from './page.js';

const SECRET = 'cursor-secret-cursor-secret-cursor-secret';

describe('parseLimit', () => {
  it('defaults when absent', () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
    expect(parseLimit('')).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('accepts values between 1 and the maximum', () => {
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit(MAX_PAGE_LIMIT)).toBe(100);
  });

  it.each(['0', '101', '-1', '1.5', 'ten', ' 5', 0, 101, 2.5])('rejects %j', (value) => {
    expect(() => parseLimit(value)).toThrow(AppError);
  });
});

describe('CursorCodec', () => {
  const codec = new CursorCodec(SECRET);

  it('round-trips a payload', () => {
    const payload = { createdAt: '2026-09-30T10:00:00.000Z', id: 'abc', n: 3, flag: true, x: null };
    expect(codec.decode(codec.encode(payload))).toEqual(payload);
  });

  it('produces opaque url-safe cursors', () => {
    expect(codec.encode({ id: 'a/b+c' })).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('rejects a tampered payload', () => {
    const [, signature] = codec.encode({ id: 'a' }).split('.');
    const forgedBody = Buffer.from(JSON.stringify({ id: 'b' })).toString('base64url');
    expect(() => codec.decode(`${forgedBody}.${signature ?? ''}`)).toThrow(AppError);
  });

  it('rejects a cursor signed with another secret', () => {
    const other = new CursorCodec(`${SECRET}-other`);
    expect(() => codec.decode(other.encode({ id: 'a' }))).toThrow(AppError);
  });

  it.each(['', 'garbage', 'a.b.c', '.', 'abc.'])('rejects %j', (cursor) => {
    expect(() => codec.decode(cursor)).toThrow(AppError);
  });

  it('rejects signed payloads that are not flat objects', () => {
    const body = Buffer.from(JSON.stringify([1, 2])).toString('base64url');
    const forger = new CursorCodec(SECRET);
    const signature = forger.encode({}).split('.')[1];
    expect(() => codec.decode(`${body}.${signature ?? ''}`)).toThrow(AppError);
  });

  it('requires a strong secret', () => {
    expect(() => new CursorCodec('short')).toThrow(RangeError);
  });
});

describe('toPage', () => {
  it('returns a next cursor when more rows exist', () => {
    const page = toPage([1, 2, 3], 2, (last) => `after-${String(last)}`);
    expect(page).toEqual({ data: [1, 2], nextCursor: 'after-2' });
  });

  it('returns a null cursor on the last page', () => {
    expect(toPage([1, 2], 2, String)).toEqual({ data: [1, 2], nextCursor: null });
    expect(toPage([], 2, String)).toEqual({ data: [], nextCursor: null });
  });
});
