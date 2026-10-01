import { AppError } from '@super-app/common';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, coerceTypes: false });

export type BodySchema = Readonly<Record<string, unknown>>;

export class BodyValidator<T> {
  private readonly validate: ValidateFunction<T>;

  constructor(schema: BodySchema) {
    this.validate = ajv.compile<T>(schema);
  }

  parse(body: unknown): T {
    if (this.validate(body)) {
      return body;
    }
    throw new AppError('VALIDATION_FAILED', {
      issues: (this.validate.errors ?? []).map((error) => ({
        path: error.instancePath || '/',
        message: error.message ?? 'invalid',
      })),
    });
  }
}

export function compileSchema(schema: BodySchema): ValidateFunction {
  return ajv.compile(schema);
}

export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export function requireUuid(value: string, field: string): string {
  if (!new RegExp(UUID_PATTERN).test(value)) {
    throw new AppError('VALIDATION_FAILED', { field, reason: 'INVALID_UUID' });
  }
  return value;
}
