import type { AdminPrincipal, ResolvedApiKey } from './ports.js';
import type { VerifiedToken } from './tokens.js';

export type Principal =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'token'; readonly token: VerifiedToken; readonly steppedUp: boolean }
  | { readonly kind: 'api-key'; readonly apiKey: ResolvedApiKey }
  | { readonly kind: 'admin'; readonly admin: AdminPrincipal };

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    rawBody?: Buffer;
  }
}
