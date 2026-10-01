import { type DynamicModule, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { AdapterRegistry } from '@super-app/adapters';
import { type AdminPrincipalResolver, AuthModule } from '@super-app/auth';
import { CursorCodec } from '@super-app/common';
import { IdempotencyStore, type StdTables } from '@super-app/db';
import { HealthModule, IDEMPOTENCY_PORT, IdempotencyInterceptor } from '@super-app/nest';
import type { Redis } from 'ioredis';
import { type Kysely, sql } from 'kysely';
import { AdaptersController } from './adapters/adapters.controller.js';
import { AdaptersService } from './adapters/adapters.service.js';
import { AppsController } from './apps/apps.controller.js';
import { AppsService } from './apps/apps.service.js';
import { TENANCY_SCHEMA } from './db/migration-sql.js';
import { DomainsController } from './domains/domains.controller.js';
import { DomainsService } from './domains/domains.service.js';
import { TenantGrpcService } from './grpc/tenant.grpc.js';
import { ProfilesController } from './profiles/profiles.controller.js';
import { ProfilesService } from './profiles/profiles.service.js';
import type { TenancyDb } from './shared/tenancy-db.js';
import { ADAPTER_REGISTRY, CURSOR_CODEC, REDIS, TENANCY_DB } from './shared/tokens.js';
import { TenantsController } from './tenants/tenants.controller.js';
import { TenantsService } from './tenants/tenants.service.js';

export const PLATFORM_PATH_PREFIXES = ['/console/v1'] as const;

export interface TenantServiceDependencies {
  readonly db: TenancyDb;
  readonly idempotencyDb: Kysely<StdTables>;
  readonly redis: Redis;
  readonly registry: AdapterRegistry;
  readonly adminResolver: AdminPrincipalResolver;
  readonly cursorSecret: string;
  readonly onShutdown?: () => Promise<void>;
}

const SHUTDOWN = Symbol('SHUTDOWN');

@Injectable()
class ShutdownHook implements OnModuleDestroy {
  constructor(@Inject(SHUTDOWN) private readonly shutdown: () => Promise<void>) {}

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }
}

@Module({})
export class AppModule {
  static forRoot(deps: TenantServiceDependencies): DynamicModule {
    return {
      module: AppModule,
      imports: [
        HealthModule.forRoot([
          {
            name: 'postgres',
            check: async () => {
              await deps.db.reader.$queryRaw`SELECT 1`;
            },
          },
          {
            name: 'redis',
            check: async () => {
              await deps.redis.ping();
            },
          },
          {
            name: 'idempotency',
            check: async () => {
              await sql`SELECT 1`.execute(deps.idempotencyDb);
            },
          },
        ]),
        AuthModule.forRoot({ adminPrincipalResolver: deps.adminResolver }),
      ],
      controllers: [TenantsController, ProfilesController, AdaptersController, DomainsController, AppsController],
      providers: [
        { provide: TENANCY_DB, useValue: deps.db },
        { provide: REDIS, useValue: deps.redis },
        { provide: ADAPTER_REGISTRY, useValue: deps.registry },
        { provide: CURSOR_CODEC, useValue: new CursorCodec(deps.cursorSecret) },
        {
          provide: IDEMPOTENCY_PORT,
          useValue: new IdempotencyStore(deps.idempotencyDb, deps.redis, TENANCY_SCHEMA),
        },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: SHUTDOWN, useValue: deps.onShutdown ?? (() => Promise.resolve()) },
        ShutdownHook,
        TenantsService,
        ProfilesService,
        AdaptersService,
        DomainsService,
        AppsService,
        TenantGrpcService,
      ],
    };
  }
}
