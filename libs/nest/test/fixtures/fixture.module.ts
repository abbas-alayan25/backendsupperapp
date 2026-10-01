import { Body, Controller, Get, Inject, Module, Post } from '@nestjs/common';
import { AppError, type Logger, currentContext, setContextPrincipal } from '@super-app/common';

export const FIXTURE_LOGGER = Symbol('FIXTURE_LOGGER');

@Controller()
class FixtureController {
  constructor(@Inject(FIXTURE_LOGGER) private readonly logger: Logger) {}

  @Get('context')
  context(): Record<string, unknown> {
    setContextPrincipal({ userId: 'user-42' });
    this.logger.info('handled');
    return { ...currentContext() };
  }

  @Get('insufficient')
  insufficient(): never {
    throw new AppError('INSUFFICIENT_FUNDS', { walletId: 'w1' });
  }

  @Get('rate-limited')
  rateLimited(): never {
    throw new AppError('RATE_LIMITED', {}, { retryAfterSeconds: 30 });
  }

  @Get('boom')
  boom(): never {
    throw new Error('password=hunter2 at db.internal:5432');
  }

  @Get('platform/tenants')
  platform(): Record<string, unknown> {
    return { ...currentContext() };
  }

  @Get('health/live')
  live(): { status: string; tenantId: string | null } {
    return { status: 'ok', tenantId: currentContext()?.tenantId ?? null };
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

export function fixtureModule(logger: Logger) {
  @Module({
    controllers: [FixtureController],
    providers: [{ provide: FIXTURE_LOGGER, useValue: logger }],
  })
  class FixtureModule {}
  return FixtureModule;
}
