import { AppError } from '../errors/app-error.js';
import { fromDecimalString, toDecimalString } from './decimal.js';
import type { Money } from './money.js';

export interface ApiMoney {
  amount: string;
  currency: string;
}

export function toApiMoney(value: Money): ApiMoney {
  return { amount: toDecimalString(value), currency: value.currency };
}

export function fromApiMoney(value: unknown): Money {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as Partial<ApiMoney>).amount !== 'string' ||
    typeof (value as Partial<ApiMoney>).currency !== 'string'
  ) {
    throw new AppError('VALIDATION_FAILED', { field: 'money', reason: 'INVALID_MONEY' });
  }
  const { amount, currency } = value as ApiMoney;
  return fromDecimalString(amount, currency);
}
