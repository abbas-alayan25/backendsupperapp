import { SetMetadata } from '@nestjs/common';
import { AUTH_LEVEL_METADATA, type AuthLevel } from '@super-app/common';

export function Auth(level: AuthLevel): MethodDecorator & ClassDecorator {
  return SetMetadata(AUTH_LEVEL_METADATA, level);
}

export function RequirePermission(permission: string): MethodDecorator & ClassDecorator {
  return Auth({ admin: permission });
}
