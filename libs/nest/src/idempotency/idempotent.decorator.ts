import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENCY_METADATA = 'super-app:idempotency';

export interface IdempotencyOptions {
  readonly required: boolean;
}

export function Idempotent(
  options: IdempotencyOptions = { required: true },
): MethodDecorator & ClassDecorator {
  return SetMetadata(IDEMPOTENCY_METADATA, options);
}
