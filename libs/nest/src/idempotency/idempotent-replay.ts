export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

export class IdempotentReplay extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super('Idempotent replay');
    this.name = 'IdempotentReplay';
  }
}
