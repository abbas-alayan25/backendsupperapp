import {
  AppError,
  PLATFORM_TENANT_ID,
  type Locale,
  isUuid,
  resolveLocale,
  runWithContext,
  toErrorEnvelope,
} from '@super-app/common';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

export const TENANT_HEADER = 'x-tenant-id';
export const REQUEST_ID_HEADER = 'x-request-id';

export interface TenantContextHookOptions {
  defaultLocale: Locale;
  tenantExemptPaths: readonly string[];
  platformPathPrefixes?: readonly string[];
}

export function matchesPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function createTenantContextHook(options: TenantContextHookOptions) {
  const exempt = new Set(options.tenantExemptPaths);
  return function tenantContextHook(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    void reply.header(REQUEST_ID_HEADER, request.id);
    const locale = resolveLocale(
      headerValue(request.headers['accept-language']),
      options.defaultLocale,
    );
    const path = request.url.split('?')[0] ?? '';
    if (exempt.has(path)) {
      done();
      return;
    }
    if (matchesPrefix(path, options.platformPathPrefixes ?? [])) {
      runWithContext(
        { tenantId: PLATFORM_TENANT_ID, requestId: request.id, locale, scope: 'platform' },
        done,
      );
      return;
    }
    const tenantId = headerValue(request.headers[TENANT_HEADER]);
    if (!tenantId || !isUuid(tenantId)) {
      const error = new AppError('FORBIDDEN', { reason: 'TENANT_UNRESOLVED' });
      void reply.code(error.httpStatus).send(toErrorEnvelope(error, locale, request.id));
      return;
    }
    runWithContext({ tenantId: tenantId.toLowerCase(), requestId: request.id, locale }, done);
  };
}
