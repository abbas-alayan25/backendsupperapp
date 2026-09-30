import { AppError, isUuid } from '@super-app/common';
import {
  type CryptoKey,
  type JWTPayload,
  type JWTVerifyGetKey,
  type KeyObject,
  SignJWT,
  errors as joseErrors,
  jwtVerify,
} from 'jose';

export const TOKEN_TYPES = ['reg', 'user', 'staff', 'rider'] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];

export const ACCESS_TOKEN_TTL_SECONDS = 600;

export interface TokenClaims {
  readonly tid: string;
  readonly sub: string;
  readonly dev: string;
  readonly typ: TokenType;
}

export interface VerifiedToken extends TokenClaims {
  readonly jti: string | undefined;
  readonly expiresAt: Date;
}

function isTokenType(value: unknown): value is TokenType {
  return typeof value === 'string' && (TOKEN_TYPES as readonly string[]).includes(value);
}

function unauthenticated(reason: string): AppError {
  return new AppError('UNAUTHENTICATED', { reason });
}

export class JwtVerifier {
  constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly issuer: string,
  ) {}

  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        algorithms: ['EdDSA'],
        issuer: this.issuer,
        requiredClaims: ['exp', 'sub'],
      }));
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw unauthenticated('TOKEN_EXPIRED');
      }
      throw unauthenticated('TOKEN_INVALID');
    }
    const { tid, dev, typ, sub, exp, jti } = payload as JWTPayload & Record<string, unknown>;
    if (typeof tid !== 'string' || !isUuid(tid)) throw unauthenticated('TOKEN_INVALID');
    if (typeof dev !== 'string' || dev.length === 0) throw unauthenticated('TOKEN_INVALID');
    if (!isTokenType(typ)) throw unauthenticated('TOKEN_INVALID');
    if (typeof sub !== 'string' || typeof exp !== 'number') throw unauthenticated('TOKEN_INVALID');
    return {
      tid,
      sub,
      dev,
      typ,
      jti: typeof jti === 'string' ? jti : undefined,
      expiresAt: new Date(exp * 1000),
    };
  }
}

export class JwtSigner {
  constructor(
    private readonly privateKey: CryptoKey | KeyObject,
    private readonly keyId: string,
    private readonly issuer: string,
  ) {}

  sign(
    claims: TokenClaims,
    options: { ttlSeconds?: number; jti?: string; now?: Date } = {},
  ): Promise<string> {
    const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
    const jwt = new SignJWT({ tid: claims.tid, dev: claims.dev, typ: claims.typ })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keyId, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.issuer)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + (options.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS));
    if (options.jti) {
      jwt.setJti(options.jti);
    }
    return jwt.sign(this.privateKey);
  }
}
