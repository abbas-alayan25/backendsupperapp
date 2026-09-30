import { AsyncLocalStorage } from 'node:async_hooks';
import type { Locale } from '../i18n/locale.js';

export type ActorType = 'USER' | 'API_KEY' | 'ADMIN' | 'SERVICE';

export interface Actor {
  readonly type: ActorType;
  readonly id: string;
}

export interface RequestContext {
  readonly tenantId: string;
  readonly requestId: string;
  readonly locale: Locale;
  userId?: string;
  deviceId?: string;
  actor?: Actor;
}

export class MissingRequestContextError extends Error {
  constructor() {
    super('No request context is active');
    this.name = 'MissingRequestContextError';
  }
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new MissingRequestContextError();
  }
  return context;
}

export function requireTenantId(): string {
  return requireContext().tenantId;
}

export function setContextPrincipal(principal: {
  userId?: string;
  deviceId?: string;
  actor?: Actor;
}): void {
  const context = requireContext();
  if (principal.actor !== undefined) {
    context.actor = principal.actor;
  } else if (principal.userId !== undefined) {
    context.actor = { type: 'USER', id: principal.userId };
  }
  if (principal.userId !== undefined) {
    context.userId = principal.userId;
  }
  if (principal.deviceId !== undefined) {
    context.deviceId = principal.deviceId;
  }
}
