export const STEP_UP_VERIFIER = Symbol('STEP_UP_VERIFIER');
export const API_KEY_RESOLVER = Symbol('API_KEY_RESOLVER');
export const ADMIN_PRINCIPAL_RESOLVER = Symbol('ADMIN_PRINCIPAL_RESOLVER');
export const JWT_VERIFIER = Symbol('JWT_VERIFIER');

export interface StepUpVerification {
  readonly tenantId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly token: string;
  readonly requestHash: string;
}

export interface StepUpVerifier {
  verify(request: StepUpVerification): Promise<boolean>;
}

export interface ResolvedApiKey {
  readonly apiKeyId: string;
  readonly ownerType: 'MERCHANT' | 'TENANT';
  readonly ownerId: string;
  readonly secrets: readonly string[];
  readonly scopes: readonly string[];
  readonly ipAllowlist: readonly string[];
}

export interface ApiKeyResolver {
  resolve(tenantId: string, keyPrefix: string): Promise<ResolvedApiKey | undefined>;
}

export interface AdminPrincipal {
  readonly adminUserId: string;
  readonly tenantId: string | null;
  readonly scope: 'PLATFORM' | 'TENANT';
  readonly permissions: ReadonlySet<string>;
}

export interface AdminPrincipalResolver {
  resolve(bearerToken: string, tenantId: string): Promise<AdminPrincipal | undefined>;
}
