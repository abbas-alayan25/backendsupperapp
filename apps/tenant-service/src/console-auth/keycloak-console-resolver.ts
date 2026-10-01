import type { AdminPrincipal, AdminPrincipalResolver } from '@super-app/auth';
import { type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { permissionsForRoles } from './permissions.js';

const ALGORITHMS = ['RS256', 'PS256', 'ES256', 'EdDSA'];

function realmRoles(payload: JWTPayload): string[] {
  const access = (payload as { realm_access?: { roles?: unknown } }).realm_access;
  const roles = access?.roles;
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
}

export class KeycloakConsoleResolver implements AdminPrincipalResolver {
  constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly issuer: string,
  ) {}

  async resolve(bearerToken: string): Promise<AdminPrincipal | undefined> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(bearerToken, this.keys, {
        issuer: this.issuer,
        algorithms: ALGORITHMS,
        requiredClaims: ['exp', 'sub'],
      }));
    } catch {
      return undefined;
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return undefined;
    }
    return {
      adminUserId: payload.sub,
      tenantId: null,
      scope: 'PLATFORM',
      permissions: permissionsForRoles(realmRoles(payload)),
    };
  }
}
