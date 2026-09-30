import {
  Controller,
  type DynamicModule,
  Get,
  Inject,
  Module,
  Res,
  SetMetadata,
} from '@nestjs/common';
import { AUTH_LEVEL_METADATA } from '@super-app/common';
import type { FastifyReply } from 'fastify';
import { type ReadinessCheck, type ReadinessReport, evaluateReadiness } from './readiness.js';

export const HEALTH_PATH = '/health';
export const READY_PATH = '/ready';
export const HEALTH_PATHS: readonly string[] = [HEALTH_PATH, READY_PATH];
export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

@Controller()
@SetMetadata(AUTH_LEVEL_METADATA, 'Public')
class HealthController {
  constructor(@Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[]) {}

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessReport> {
    const report = await evaluateReadiness(this.checks);
    if (report.status !== 'ok') {
      void reply.status(503);
    }
    return report;
  }
}

@Module({})
export class HealthModule {
  static forRoot(checks: readonly ReadinessCheck[] = []): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [{ provide: READINESS_CHECKS, useValue: checks }],
    };
  }
}
