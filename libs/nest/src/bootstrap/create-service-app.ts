import type { IncomingMessage } from 'node:http';
import { type IEntryNestModule, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import { DEFAULT_LOCALE, type Locale, type Logger } from '@super-app/common';
import { AppExceptionFilter } from '../errors/app-exception.filter.js';
import { HEALTH_PATHS } from '../health/health.module.js';
import { PinoNestLogger } from '../logging/pino-nest-logger.js';
import { resolveRequestId } from '../tenancy/request-id.js';
import { REQUEST_ID_HEADER, createTenantContextHook } from '../tenancy/tenant-context.hook.js';

export const HTTP_PORT = 3000;

export interface ServiceAppOptions {
  logger: Logger;
  defaultLocale?: Locale;
  tenantExemptPaths?: readonly string[];
  bodyLimitBytes?: number;
}

export async function createServiceApp(
  rootModule: IEntryNestModule,
  options: ServiceAppOptions,
): Promise<NestFastifyApplication> {
  const defaultLocale = options.defaultLocale ?? DEFAULT_LOCALE;
  const adapter = new FastifyAdapter({
    loggerInstance: options.logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: options.bodyLimitBytes ?? 1_048_576,
    requestIdHeader: false,
    genReqId: (request: IncomingMessage) => resolveRequestId(request.headers[REQUEST_ID_HEADER]),
  });
  adapter.getInstance().addHook(
    'onRequest',
    createTenantContextHook({
      defaultLocale,
      tenantExemptPaths: [...HEALTH_PATHS, ...(options.tenantExemptPaths ?? [])],
    }),
  );
  const app = await NestFactory.create<NestFastifyApplication>(rootModule, adapter, {
    logger: new PinoNestLogger(options.logger),
  });
  app.useGlobalFilters(new AppExceptionFilter(options.logger, defaultLocale));
  return app;
}

export async function listen(app: NestFastifyApplication, port: number = HTTP_PORT): Promise<void> {
  await app.listen({ port, host: '0.0.0.0' });
}
