import { AppError } from '../errors/app-error.js';
import { type CurrencyCode, isCurrencyCode } from './iso4217.js';

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

export class CurrencyMismatchError extends Error {
  constructor(left: CurrencyCode, right: CurrencyCode) {
    super(`Currency mismatch: ${left} and ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

export function parseCurrency(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new AppError('VALIDATION_FAILED', { field: 'currency', reason: 'UNKNOWN_CURRENCY' });
  }
  return value;
}

export function money(amountMinor: bigint, currency: string): Money {
  return Object.freeze({ amountMinor, currency: parseCurrency(currency) });
}

export function zero(currency: string): Money {
  return money(0n, currency);
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new CurrencyMismatchError(left.currency, right.currency);
  }
}

export function add(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor + right.amountMinor, left.currency);
}

export function subtract(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function negate(value: Money): Money {
  return money(-value.amountMinor, value.currency);
}

export function compare(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);
  if (left.amountMinor === right.amountMinor) {
    return 0;
  }
  return left.amountMinor < right.amountMinor ? -1 : 1;
}

export function equals(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.amountMinor === right.amountMinor;
}

export function isZero(value: Money): boolean {
  return value.amountMinor === 0n;
}

export function isNegative(value: Money): boolean {
  return value.amountMinor < 0n;
}

export function isPositive(value: Money): boolean {
  return value.amountMinor > 0n;
}
