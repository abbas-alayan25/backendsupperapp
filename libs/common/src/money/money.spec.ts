import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { fromApiMoney, toApiMoney } from './api-money.js';
import { fromDecimalString, toDecimalString } from './decimal.js';
import { minorUnitExponent } from './iso4217.js';
import {
  CurrencyMismatchError,
  add,
  compare,
  equals,
  isNegative,
  isPositive,
  isZero,
  money,
  negate,
  subtract,
  zero,
} from './money.js';

function expectValidationFailure(fn: () => unknown, reason: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect((error as AppError).details).toMatchObject({ reason });
    return;
  }
  throw new Error('expected a validation failure');
}

describe('iso4217', () => {
  it.each([
    ['JPY', 0],
    ['USD', 2],
    ['EUR', 2],
    ['JOD', 3],
    ['KWD', 3],
    ['CLF', 4],
  ] as const)('%s has exponent %i', (currency, exponent) => {
    expect(minorUnitExponent(currency)).toBe(exponent);
  });
});

describe('decimal conversion', () => {
  it.each([
    ['JPY', '1500', 1500n],
    ['USD', '10.00', 1000n],
    ['USD', '0.05', 5n],
    ['KWD', '1.234', 1234n],
    ['JOD', '0.001', 1n],
    ['USD', '-12.34', -1234n],
  ] as const)('round-trips %s %s', (currency, amount, minor) => {
    const parsed = fromDecimalString(amount, currency);
    expect(parsed.amountMinor).toBe(minor);
    expect(toDecimalString(parsed)).toBe(amount);
  });

  it('accepts fewer decimals than the exponent and pads on output', () => {
    expect(toDecimalString(fromDecimalString('10.5', 'USD'))).toBe('10.50');
    expect(toDecimalString(fromDecimalString('7', 'KWD'))).toBe('7.000');
  });

  it('keeps values beyond 2^53 exact', () => {
    const amount = '92233720368547758.07';
    const parsed = fromDecimalString(amount, 'USD');
    expect(parsed.amountMinor).toBe(9223372036854775807n);
    expect(toDecimalString(parsed)).toBe(amount);
  });

  it.each(['1.001', '1e3', '01.0', '', 'abc', '1.', '.5', '+1.00', ' 1.00', '1,00', 'NaN'])(
    'rejects %j for USD',
    (amount) => {
      expect(() => fromDecimalString(amount, 'USD')).toThrow(AppError);
    },
  );

  it('reports too many decimals with the allowed maximum', () => {
    expectValidationFailure(() => fromDecimalString('1.001', 'USD'), 'TOO_MANY_DECIMALS');
    expectValidationFailure(() => fromDecimalString('100.0', 'JPY'), 'TOO_MANY_DECIMALS');
  });

  it('rejects unknown currencies', () => {
    expectValidationFailure(() => fromDecimalString('1.00', 'XXX'), 'UNKNOWN_CURRENCY');
    expectValidationFailure(() => fromDecimalString('1.00', 'usd'), 'UNKNOWN_CURRENCY');
  });

  it('formats negative sub-unit amounts', () => {
    expect(toDecimalString(money(-5n, 'USD'))).toBe('-0.05');
    expect(toDecimalString(money(0n, 'KWD'))).toBe('0.000');
  });
});

describe('api money', () => {
  it('converts to and from the API shape', () => {
    const value = money(123456n, 'JOD');
    expect(toApiMoney(value)).toEqual({ amount: '123.456', currency: 'JOD' });
    expect(equals(fromApiMoney({ amount: '123.456', currency: 'JOD' }), value)).toBe(true);
  });

  it.each([null, 'x', { amount: 10, currency: 'USD' }, { amount: '10.00' }])(
    'rejects malformed input %j',
    (input) => {
      expectValidationFailure(() => fromApiMoney(input), 'INVALID_MONEY');
    },
  );
});

describe('arithmetic', () => {
  const ten = money(1000n, 'USD');
  const three = money(300n, 'USD');

  it('adds and subtracts', () => {
    expect(add(ten, three).amountMinor).toBe(1300n);
    expect(subtract(three, ten).amountMinor).toBe(-700n);
    expect(negate(three).amountMinor).toBe(-300n);
  });

  it('compares', () => {
    expect(compare(ten, three)).toBe(1);
    expect(compare(three, ten)).toBe(-1);
    expect(compare(ten, money(1000n, 'USD'))).toBe(0);
  });

  it('reports sign', () => {
    expect(isZero(zero('USD'))).toBe(true);
    expect(isNegative(negate(ten))).toBe(true);
    expect(isPositive(ten)).toBe(true);
  });

  it('refuses mixed currencies', () => {
    const euros = money(1000n, 'EUR');
    expect(() => add(ten, euros)).toThrow(CurrencyMismatchError);
    expect(() => subtract(ten, euros)).toThrow(CurrencyMismatchError);
    expect(() => compare(ten, euros)).toThrow(CurrencyMismatchError);
    expect(equals(ten, euros)).toBe(false);
  });

  it('produces immutable values', () => {
    expect(Object.isFrozen(ten)).toBe(true);
  });
});
