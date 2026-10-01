import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Auth } from '@super-app/auth';
import { CONSOLE_PERMISSIONS } from '../console-auth/permissions.js';
import { BodyValidator, requireUuid } from '../shared/validation.js';
import { type AppView, AppsService, type CreateAppInput } from './apps.service.js';

const VERSION = '^[0-9]+\\.[0-9]+\\.[0-9]+$';

const createApp = new BodyValidator<CreateAppInput>({
  type: 'object',
  additionalProperties: false,
  required: ['appType', 'platform', 'bundleId', 'minSupportedVersion', 'latestVersion'],
  properties: {
    appType: { enum: ['CONSUMER', 'MERCHANT', 'RIDER'] },
    platform: { enum: ['IOS', 'ANDROID'] },
    bundleId: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)+$' },
    storeAccountRef: { type: 'string', minLength: 1, maxLength: 200 },
    minSupportedVersion: { type: 'string', pattern: VERSION },
    latestVersion: { type: 'string', pattern: VERSION },
  },
});

@Controller('console/v1/tenants/:id/apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Get()
  @Auth({ admin: CONSOLE_PERMISSIONS.view })
  async list(@Param('id') id: string): Promise<{ data: AppView[]; nextCursor: null }> {
    return { data: await this.apps.list(requireUuid(id, 'id')), nextCursor: null };
  }

  @Post()
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  create(@Param('id') id: string, @Body() body: unknown): Promise<AppView> {
    return this.apps.create(requireUuid(id, 'id'), createApp.parse(body));
  }
}
