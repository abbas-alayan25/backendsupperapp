import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { AUTH_CLOCK, AuthGuard } from './auth.guard.js';
import {
  ADMIN_PRINCIPAL_RESOLVER,
  API_KEY_RESOLVER,
  type AdminPrincipalResolver,
  type ApiKeyResolver,
  JWT_VERIFIER,
  STEP_UP_VERIFIER,
  type StepUpVerifier,
} from './ports.js';
import { JwtVerifier } from './tokens.js';

export interface AuthModuleOptions {
  readonly jwtVerifier?: JwtVerifier;
  readonly stepUpVerifier?: StepUpVerifier;
  readonly apiKeyResolver?: ApiKeyResolver;
  readonly adminPrincipalResolver?: AdminPrincipalResolver;
  readonly clock?: () => Date;
}

export function remoteJwtVerifier(jwksUrl: string, issuer: string): JwtVerifier {
  return new JwtVerifier(createRemoteJWKSet(new URL(jwksUrl)), issuer);
}

@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    const providers: Provider[] = [{ provide: APP_GUARD, useClass: AuthGuard }];
    const optional: [symbol, unknown][] = [
      [JWT_VERIFIER, options.jwtVerifier],
      [STEP_UP_VERIFIER, options.stepUpVerifier],
      [API_KEY_RESOLVER, options.apiKeyResolver],
      [ADMIN_PRINCIPAL_RESOLVER, options.adminPrincipalResolver],
      [AUTH_CLOCK, options.clock],
    ];
    for (const [token, value] of optional) {
      if (value !== undefined) {
        providers.push({ provide: token, useValue: value });
      }
    }
    return { module: AuthModule, providers };
  }
}
