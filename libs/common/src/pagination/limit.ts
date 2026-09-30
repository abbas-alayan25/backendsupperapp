import { AppError } from '../errors/app-error.js';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function parseLimit(raw: string | number | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_PAGE_LIMIT;
  }
  const value = typeof raw === 'number' ? raw : /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new AppError('VALIDATION_FAILED', {
      field: 'limit',
      reason: 'OUT_OF_RANGE',
      min: 1,
      max: MAX_PAGE_LIMIT,
    });
  }
  return value;
}
