import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { type CatalogEntry, PARTNER_TYPES, type ProbeResult } from '@super-app/adapters';
import { Auth } from '@super-app/auth';
import { CONSOLE_PERMISSIONS } from '../console-auth/permissions.js';
import { BodyValidator, requireUuid } from '../shared/validation.js';
import {
  type AdapterView,
  AdaptersService,
  type CreateAdapterInput,
  type UpdateAdapterInput,
} from './adapters.service.js';

const createAdapter = new BodyValidator<CreateAdapterInput>({
  type: 'object',
  additionalProperties: false,
  required: ['partnerType', 'provider', 'priority'],
  properties: {
    partnerType: { enum: [...PARTNER_TYPES] },
    provider: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' },
    priority: { type: 'integer', minimum: 1, maximum: 100 },
    config: { type: 'object' },
  },
});

const updateAdapter = new BodyValidator<UpdateAdapterInput>({
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    priority: { type: 'integer', minimum: 1, maximum: 100 },
    config: { type: 'object' },
    status: { enum: ['ACTIVE', 'DISABLED'] },
    version: { type: 'integer', minimum: 0 },
  },
});

@Controller('console/v1')
export class AdaptersController {
  constructor(private readonly adapters: AdaptersService) {}

  @Get('adapters/catalog')
  @Auth({ admin: CONSOLE_PERMISSIONS.view })
  catalog(): { data: CatalogEntry[]; nextCursor: null } {
    return { data: this.adapters.catalog(), nextCursor: null };
  }

  @Get('tenants/:id/adapters')
  @Auth({ admin: CONSOLE_PERMISSIONS.view })
  async list(@Param('id') id: string): Promise<{ data: AdapterView[]; nextCursor: null }> {
    return { data: await this.adapters.list(requireUuid(id, 'id')), nextCursor: null };
  }

  @Post('tenants/:id/adapters')
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  create(@Param('id') id: string, @Body() body: unknown): Promise<AdapterView> {
    return this.adapters.create(requireUuid(id, 'id'), createAdapter.parse(body));
  }

  @Patch('tenants/:id/adapters/:adapterId')
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  update(@Param('id') id: string, @Param('adapterId') adapterId: string, @Body() body: unknown): Promise<AdapterView> {
    return this.adapters.update(requireUuid(id, 'id'), requireUuid(adapterId, 'adapterId'), updateAdapter.parse(body));
  }

  @Delete('tenants/:id/adapters/:adapterId')
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  disable(@Param('id') id: string, @Param('adapterId') adapterId: string): Promise<AdapterView> {
    return this.adapters.disable(requireUuid(id, 'id'), requireUuid(adapterId, 'adapterId'));
  }

  @Post('tenants/:id/adapters/:adapterId/test')
  @HttpCode(200)
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  test(
    @Param('id') id: string,
    @Param('adapterId') adapterId: string,
  ): Promise<ProbeResult & { readonly adapterId: string }> {
    return this.adapters.test(requireUuid(id, 'id'), requireUuid(adapterId, 'adapterId'));
  }
}
