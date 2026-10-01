import { BlockList, isIP } from 'node:net';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTH_LEVEL_METADATA,
  AppError,
  type AuthLevel,
  type SimpleAuthLevel,
  firstHeader,
  parseDeviceId,
  requireContext,
  setContextPrincipal,
} from '@super-app/common';
import type { FastifyRequest } from 'fastify';
import { stepUpRequestHash } from './hashing.js';
import { verifyMerchantSignature } from './merchant-signature.js';
import {
  ADMIN_PRINCIPAL_RESOLVER,
  API_KEY_RESOLVER,
  type AdminPrincipalResolver,
  type ApiKeyResolver,
  JWT_VERIFIER,
  STEP_UP_VERIFIER,
  type StepUpVerifier,
} from './ports.js';
import type { JwtVerifier, TokenType } from './tokens.js';

export const AUTH_CLOCK = Symbol('AUTH_CLOCK');

const TOKEN_TYPE_BY_LEVEL: Readonly<Record<Exclude<SimpleAuthLevel, 'Public' | 'Key'>, TokenType>> =
  {
    Reg: 'reg',
    User: 'user',
    'Step-up': 'user',
    Staff: 'staff',
    Rider: 'rider',
  };

function bearerToken(request: FastifyRequest): string {
  const header = firstHeader(request.headers.authorization);
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  const token = match?.[1];
  if (!token) {
    throw new AppError('UNAUTHENTICATED', { reason: 'MISSING_TOKEN' });
  }
  return token;
}

function misconfigured(port: string): Error {
  return new Error(`${port} is not configured for this service`);
}

export function ipAllowed(ip: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  const family = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
  const list = new BlockList();
  for (const entry of allowlist) {
    const [address = '', prefix] = entry.split('/');
    const entryFamily = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) {
      list.addAddress(address, entryFamily);
    } else {
      list.addSubnet(address, Number(prefix), entryFamily);
    }
  }
  return list.check(ip, family);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(JWT_VERIFIER) private readonly jwt?: JwtVerifier,
    @Optional() @Inject(STEP_UP_VERIFIER) private readonly stepUp?: StepUpVerifier,
    @Optional() @Inject(API_KEY_RESOLVER) private readonly apiKeys?: ApiKeyResolver,
    @Optional() @Inject(ADMIN_PRINCIPAL_RESOLVER) private readonly admins?: AdminPrincipalResolver,
    @Optional() @Inject(AUTH_CLOCK) private readonly clock?: () => Date,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const level = this.reflector.getAllAndOverride<AuthLevel | undefined>(AUTH_LEVEL_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (level === undefined) {
      throw new AppError('FORBIDDEN', { reason: 'NO_AUTH_LEVEL' });
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (level === 'Public') {
      request.principal = { kind: 'anonymous' };
      return true;
    }
    const tenantId = requireContext().tenantId;
    if (level === 'Key') {
      await this.authenticateApiKey(request, tenantId);
      return true;
    }
    if (typeof level === 'object') {
      await this.authenticateAdmin(request, tenantId, level.admin);
      return true;
    }
    await this.authenticateToken(request, tenantId, level);
    return true;
  }

  private async authenticateToken(
    request: FastifyRequest,
    tenantId: string,
    level: Exclude<SimpleAuthLevel, 'Public' | 'Key'>,
  ): Promise<void> {
    if (!this.jwt) throw misconfigured('JwtVerifier');
    const token = await this.jwt.verify(bearerToken(request));
    if (token.tid !== tenantId) {
      throw new AppError('FORBIDDEN', { reason: 'TENANT_MISMATCH' });
    }
    const deviceId = parseDeviceId(request.headers['x-device-id']);
    if (deviceId !== token.dev) {
      throw new AppError('UNAUTHENTICATED', { reason: 'DEVICE_MISMATCH' });
    }
    if (token.typ !== TOKEN_TYPE_BY_LEVEL[level]) {
      throw new AppError('FORBIDDEN', { reason: 'TOKEN_TYPE_NOT_ALLOWED' });
    }
    let steppedUp = false;
    if (level === 'Step-up') {
      if (!this.stepUp) throw misconfigured('StepUpVerifier');
      const stepUpToken = firstHeader(request.headers['x-step-up-token']);
      if (!stepUpToken) {
        throw new AppError('STEP_UP_REQUIRED', { reason: 'MISSING_STEP_UP_TOKEN' });
      }
      const verified = await this.stepUp.verify({
        tenantId,
        userId: token.sub,
        deviceId: token.dev,
        token: stepUpToken,
        requestHash: stepUpRequestHash(request.method, request.url, request.rawBody),
      });
      if (!verified) {
        throw new AppError('STEP_UP_REQUIRED', { reason: 'STEP_UP_TOKEN_INVALID' });
      }
      steppedUp = true;
    }
    request.principal = { kind: 'token', token, steppedUp };
    setContextPrincipal({ userId: token.sub, deviceId: token.dev });
  }

  private async authenticateApiKey(request: FastifyRequest, tenantId: string): Promise<void> {
    if (!this.apiKeys) throw misconfigured('ApiKeyResolver');
    const keyId = firstHeader(request.headers['x-key-id']);
    const timestamp = firstHeader(request.headers['x-timestamp']);
    const signature = firstHeader(request.headers['x-signature']);
    if (!keyId || !timestamp || !signature) {
      throw new AppError('UNAUTHENTICATED', { reason: 'MISSING_SIGNATURE' });
    }
    const apiKey = await this.apiKeys.resolve(tenantId, keyId);
    if (!apiKey) {
      throw new AppError('UNAUTHENTICATED', { reason: 'UNKNOWN_API_KEY' });
    }
    const check = verifyMerchantSignature(
      apiKey.secrets,
      { method: request.method, pathWithQuery: request.url, timestamp, rawBody: request.rawBody },
      signature,
      this.clock?.() ?? new Date(),
    );
    if (!check.valid) {
      throw new AppError('UNAUTHENTICATED', { reason: check.reason });
    }
    if (!ipAllowed(request.ip, apiKey.ipAllowlist)) {
      throw new AppError('FORBIDDEN', { reason: 'IP_NOT_ALLOWED' });
    }
    request.principal = { kind: 'api-key', apiKey: { ...apiKey, secrets: [] } };
    setContextPrincipal({ actor: { type: 'API_KEY', id: apiKey.apiKeyId } });
  }

  private async authenticateAdmin(
    request: FastifyRequest,
    tenantId: string,
    permission: string,
  ): Promise<void> {
    if (!this.admins) throw misconfigured('AdminPrincipalResolver');
    const admin = await this.admins.resolve(bearerToken(request), tenantId);
    if (!admin) {
      throw new AppError('UNAUTHENTICATED', { reason: 'ADMIN_SESSION_INVALID' });
    }
    if (admin.scope === 'TENANT' && admin.tenantId !== tenantId) {
      throw new AppError('FORBIDDEN', { reason: 'TENANT_MISMATCH' });
    }
    if (permission !== 'any' && !admin.permissions.has(permission)) {
      throw new AppError('FORBIDDEN', { reason: 'PERMISSION_REQUIRED', permission });
    }
    request.principal = { kind: 'admin', admin };
    setContextPrincipal({ actor: { type: 'ADMIN', id: admin.adminUserId } });
  }
}
