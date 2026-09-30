import { AppError } from '../errors/app-error.js';
import { minorUnitExponent } from './iso4217.js';
import { type Money, money, parseCurrency } from './money.js';

const DECIMAL_PATTERN = /^(-)?(0|[1-9]\d*)(?:\.(\d+))?$/;

export function toDecimalString(value: Money): string {
  const exponent = minorUnitExponent(value.currency);
  const negative = value.amountMinor < 0n;
  const digits = (negative ? -value.amountMinor : value.amountMinor)
    .toString()
    .padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  const unsigned = exponent === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${unsigned}` : unsigned;
}

export function fromDecimalString(amount: string, currency: string): Money {
  const code = parseCurrency(currency);
  const exponent = minorUnitExponent(code);
  const match = DECIMAL_PATTERN.exec(amount);
  if (!match) {
    throw new AppError('VALIDATION_FAILED', { field: 'amount', reason: 'INVALID_DECIMAL' });
  }
  const sign = match[1];
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';
  if (fraction.length > exponent) {
    throw new AppError('VALIDATION_FAILED', {
      field: 'amount',
      reason: 'TOO_MANY_DECIMALS',
      maxDecimals: exponent,
    });
  }
  const minor = BigInt(whole + fraction.padEnd(exponent, '0'));
  return money(sign ? -minor : minor, code);
}
