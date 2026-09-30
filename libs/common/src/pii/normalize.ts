import { AppError } from '../errors/app-error.js';

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SEPARATORS = /[\s\-().]/g;

function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

export function normalizePhone(raw: string): string {
  let value = toAsciiDigits(raw.trim()).replace(PHONE_SEPARATORS, '');
  if (value.startsWith('00')) {
    value = `+${value.slice(2)}`;
  }
  if (!E164_PATTERN.test(value)) {
    throw new AppError('VALIDATION_FAILED', { field: 'phone', reason: 'INVALID_E164' });
  }
  return value;
}

export function normalizeEmail(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(value)) {
    throw new AppError('VALIDATION_FAILED', { field: 'email', reason: 'INVALID_EMAIL' });
  }
  return value;
}
