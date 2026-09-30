import { isUuidV7 } from '@super-app/common';
import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id.js';

describe('resolveRequestId', () => {
  it.each(['req-1', 'abc.DEF_123:x', '0192f5a0-0000-7000-8000-000000000001'])(
    'keeps a safe client id %j',
    (value) => {
      expect(resolveRequestId(value)).toBe(value);
    },
  );

  it('uses the first value of a repeated header', () => {
    expect(resolveRequestId(['first', 'second'])).toBe('first');
  });

  it.each([undefined, '', 'has space', '<script>', 'a'.repeat(129), 'line\nbreak'])(
    'replaces %j with a new UUIDv7',
    (value) => {
      expect(isUuidV7(resolveRequestId(value))).toBe(true);
    },
  );
});
