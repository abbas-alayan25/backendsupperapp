import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const canonical = canonicalize(value);
  return canonical === undefined ? 'null' : JSON.stringify(canonical);
}

export function requestHash(request: { method: string; path: string; body: unknown }): string {
  return createHash('sha256')
    .update(`${request.method.toUpperCase()}\n${request.path}\n${canonicalJson(request.body)}`)
    .digest('hex');
}
