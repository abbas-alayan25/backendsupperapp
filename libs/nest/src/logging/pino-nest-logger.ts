import type { LoggerService } from '@nestjs/common';
import type { Logger } from '@super-app/common';

function toMessage(message: unknown): string {
  return typeof message === 'string' ? message : JSON.stringify(message);
}

export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, toMessage(message));
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, toMessage(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, toMessage(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, toMessage(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, toMessage(message));
  }

  fatal(message: unknown, context?: string): void {
    this.logger.fatal({ context }, toMessage(message));
  }
}
