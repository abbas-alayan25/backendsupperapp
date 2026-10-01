import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '@super-app/auth';
import type { Page } from '@super-app/common';
import { CONSOLE_PERMISSIONS } from '../console-auth/permissions.js';
import { BodyValidator, requireUuid } from '../shared/validation.js';
import type { TenantView } from './tenant-view.js';
import { type CreateTenantInput, TenantsService, type UpdateTenantInput } from './tenants.service.js';

const createTenant = new BodyValidator<CreateTenantInput>({
  type: 'object',
  additionalProperties: false,
  required: ['code', 'legalName', 'displayName', 'country', 'deploymentModel', 'region'],
  properties: {
    code: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,30}[a-z0-9]$' },
    legalName: { type: 'string', minLength: 1, maxLength: 200 },
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
    country: { type: 'string', pattern: '^[A-Z]{2}$' },
    deploymentModel: { enum: ['SHARED', 'DEDICATED'] },
    region: { type: 'string', pattern: '^[a-z]{2}(-[a-z]+)+-[0-9]$' },
  },
});

const updateTenant = new BodyValidator<UpdateTenantInput>({
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    legalName: { type: 'string', minLength: 1, maxLength: 200 },
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
    version: { type: 'integer', minimum: 0 },
  },
});

@Controller('console/v1/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @Auth({ admin: CONSOLE_PERMISSIONS.view })
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
  ): Promise<Page<TenantView>> {
    return this.tenants.list({ limit, cursor, status });
  }

  @Post()
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  create(@Body() body: unknown): Promise<TenantView> {
    return this.tenants.create(createTenant.parse(body));
  }

  @Get(':id')
  @Auth({ admin: CONSOLE_PERMISSIONS.view })
  get(@Param('id') id: string): Promise<TenantView> {
    return this.tenants.get(requireUuid(id, 'id'));
  }

  @Patch(':id')
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  update(@Param('id') id: string, @Body() body: unknown): Promise<TenantView> {
    return this.tenants.update(requireUuid(id, 'id'), updateTenant.parse(body));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  suspend(@Param('id') id: string): Promise<TenantView> {
    return this.tenants.transition(requireUuid(id, 'id'), 'suspend');
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  reactivate(@Param('id') id: string): Promise<TenantView> {
    return this.tenants.transition(requireUuid(id, 'id'), 'reactivate');
  }
}
