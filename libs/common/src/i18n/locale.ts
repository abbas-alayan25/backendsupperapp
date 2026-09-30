export const SUPPORTED_LOCALES = ['ar', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

interface LanguageRange {
  primary: string;
  quality: number;
  position: number;
}

function isSupported(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function parseRange(part: string, position: number): LanguageRange | null {
  const [tag, ...params] = part.trim().split(';');
  if (!tag) {
    return null;
  }
  let quality = 1;
  for (const param of params) {
    const [name, value] = param.trim().split('=');
    if (name === 'q' && value !== undefined) {
      const parsed = Number(value);
      quality = Number.isFinite(parsed) ? parsed : 0;
    }
  }
  const primary = tag.trim().toLowerCase().split('-')[0] ?? '';
  return { primary, quality, position };
}

export function resolveLocale(
  header: string | undefined,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  if (!header) {
    return fallback;
  }
  const ranges = header
    .split(',')
    .map((part, index) => parseRange(part, index))
    .filter((range): range is LanguageRange => range !== null && range.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.position - b.position);
  for (const range of ranges) {
    if (isSupported(range.primary)) {
      return range.primary;
    }
  }
  return fallback;
}
