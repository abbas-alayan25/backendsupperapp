import { describe, expect, it } from 'vitest';
import { resolveLocale } from './locale.js';

describe('resolveLocale', () => {
  it.each([
    ['ar', 'ar'],
    ['en-US', 'en'],
    ['ar-JO,ar;q=0.9,en;q=0.8', 'ar'],
    ['fr-FR,en;q=0.5,ar;q=0.9', 'ar'],
    ['AR', 'ar'],
    ['ar;q=0,en', 'en'],
  ] as const)('%j resolves to %s', (header, locale) => {
    expect(resolveLocale(header)).toBe(locale);
  });

  it.each([undefined, '', 'fr', '*', 'de-DE,fr;q=0.8', 'ar;q=abc'])(
    'falls back for %j',
    (header) => {
      expect(resolveLocale(header, 'ar')).toBe('ar');
      expect(resolveLocale(header)).toBe('en');
    },
  );
});
