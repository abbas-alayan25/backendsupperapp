import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Auth } from '@super-app/auth';
import { AppError } from '@super-app/common';
import { CONSOLE_PERMISSIONS } from '../console-auth/permissions.js';
import { requireUuid } from '../shared/validation.js';
import type { ProfileView } from './profile-view.js';
import { type ActivationResult, ProfilesService } from './profiles.service.js';

function draftBody(body: unknown): { document: unknown; feesRef?: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('VALIDATION_FAILED', { reason: 'BODY_MUST_BE_OBJECT' });
  }
  const { feesRef, ...document } = body as Record<string, unknown>;
  if (feesRef !== undefined && typeof feesRef !== 'string') {
    throw new AppError('VALIDATION_FAILED', { field: 'feesRef', reason: 'MUST_BE_STRING' });
  }
  return feesRef === undefined ? { document } : { document, feesRef };
}

@Controller('console/v1/tenants/:id/profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @Auth({ admin: CONSOLE_PERMISSIONS.view })
  async list(@Param('id') id: string): Promise<{ data: ProfileView[]; nextCursor: null }> {
    return { data: await this.profiles.list(requireUuid(id, 'id')), nextCursor: null };
  }

  @Post()
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  create(@Param('id') id: string, @Body() body: unknown): Promise<ProfileView> {
    const { document, feesRef } = draftBody(body);
    return this.profiles.createDraft(requireUuid(id, 'id'), document, feesRef);
  }

  @Post(':version/activate')
  @HttpCode(200)
  @Auth({ admin: CONSOLE_PERMISSIONS.edit })
  activate(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: unknown,
  ): Promise<ActivationResult> {
    return this.profiles.activate(requireUuid(id, 'id'), version, body);
  }
}
