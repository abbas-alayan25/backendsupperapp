import { describe, expect, it } from 'vitest';
import { isUuid, isUuidV7, newId } from './uuidv7.js';

describe('newId', () => {
  it('produces RFC 9562 version 7 UUIDs', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuidV7(id)).toBe(true);
  });

  it('is strictly increasing across 10k ids', () => {
    const ids = Array.from({ length: 10_000 }, () => newId());
    for (let index = 1; index < ids.length; index += 1) {
      expect((ids[index] ?? '') > (ids[index - 1] ?? '')).toBe(true);
    }
  });

  it('distinguishes UUID versions', () => {
    const v4 = '3b241101-e2bb-4255-8caf-4136c566a962';
    expect(isUuid(v4)).toBe(true);
    expect(isUuidV7(v4)).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
