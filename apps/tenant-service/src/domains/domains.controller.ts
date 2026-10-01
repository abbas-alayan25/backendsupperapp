import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Auth } from '@super-app/auth';
import { CONSOLE_PERMISSIONS } from '../console-auth/permissions.js';
import { BodyValidator, requireUuid } from '../shared/validation.js';
import { type CreateDomainInput, type DomainView, DomainsService } from './domains.service.js';

const createDomain = new BodyValidator<CreateDomainInput>({
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'kind'],
  properties: {
    domain: {
      type: 'string',
      maxLength: 253,
      pattern: '^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,63}$',
    },
    kind: { enum: ['API', 'ADMIN', 'MERCHANT', 'WEB'] },
  },
});

@Controller('console/v1/tenants/:id/domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  @Auth({ admin: CONSOLE_PERMISSIONS.view })
  async list(@Param('id') id: string): Promise<{ data: DomainView[]; nextCursor: null }> {
    return { data: await this.domains.list(requireUuid(id, 'id')), nextCursor: null };
  }

  @Post()
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  create(@Param('id') id: string, @Body() body: unknown): Promise<DomainView> {
    return this.domains.create(requireUuid(id, 'id'), createDomain.parse(body));
  }

  @Delete(':domainId')
  @HttpCode(204)
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  async remove(@Param('id') id: string, @Param('domainId') domainId: string): Promise<void> {
    await this.domains.remove(requireUuid(id, 'id'), requireUuid(domainId, 'domainId'));
  }
}
