import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { AppError } from '@super-app/common';
import { describe, expect, it } from 'vitest';
import { toAppError } from './app-exception.filter.js';

describe('toAppError', () => {
  it('passes AppError through unchanged', () => {
    const error = new AppError('LIMIT_EXCEEDED', { service: 'P2P' });
    expect(toAppError(error)).toBe(error);
  });

  it.each([
    [new BadRequestException('bad'), 'VALIDATION_FAILED'],
    [new NotFoundException(), 'NOT_FOUND'],
    [new HttpException('teapot', 418), 'VALIDATION_FAILED'],
    [new HttpException('gateway', 502), 'INTERNAL_ERROR'],
    [Object.assign(new Error('parse'), { statusCode: 400 }), 'VALIDATION_FAILED'],
    [Object.assign(new Error('large'), { statusCode: 413 }), 'VALIDATION_FAILED'],
    [new Error('unexpected'), 'INTERNAL_ERROR'],
    ['a string', 'INTERNAL_ERROR'],
    [null, 'INTERNAL_ERROR'],
  ] as const)('maps %s to %s', (exception, code) => {
    expect(toAppError(exception).code).toBe(code);
  });

  it('never copies exception messages into details', () => {
    expect(toAppError(new Error('secret')).details).toEqual({});
    expect(toAppError(new BadRequestException('secret')).details).toEqual({});
  });

  it('keeps the original exception as the cause', () => {
    const original = new Error('boom');
    expect(toAppError(original).cause).toBe(original);
  });
});
