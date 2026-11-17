/** Access JWTs (EdDSA, 10 min) and opaque refresh tokens (256-bit, stored as SHA-256). */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, SignJWT } from 'jose';
import type { KeyStore } from './keys.js';

export const ACCESS_TTL_S = 10 * 60;
export const REFRESH_SLIDING_MS = 30 * 24 * 3600_000;
export const REFRESH_ABSOLUTE_MS = 90 * 24 * 3600_000;

export interface AccessClaims {
  sub: string;
  sid: string;
}

export class TokenIssuer {
  private readonly verifyKeys: ReturnType<typeof createLocalJWKSet>;

  constructor(
    private readonly keys: KeyStore,
    private readonly issuer: string,
    private readonly audience: string,
  ) {
    this.verifyKeys = createLocalJWKSet(keys.jwks);
  }

  sign(claims: AccessClaims, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keys.current.kid, typ: 'at+jwt' })
      .setSubject(claims.sub)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_TTL_S)
      .setJti(randomUUID())
      .sign(this.keys.current.key);
  }

  /** Verified claims, or null (expired, bad signature, wrong alg/kid/iss/aud, missing claims). */
  async verify(token: string, now: Date): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.verifyKeys, {
        algorithms: ['EdDSA'],
        issuer: this.issuer,
        audience: this.audience,
        typ: 'at+jwt',
        requiredClaims: ['sub', 'sid', 'iat', 'exp', 'jti'],
        currentDate: now,
        clockTolerance: 5,
      });
      const { sub, sid } = payload;
      return typeof sub === 'string' && typeof sid === 'string' ? { sub, sid } : null;
    } catch {
      return null;
    }
  }
}

/** 256 random bits, base64url. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** UUIDv7 (RFC 9562): 48-bit ms timestamp + random. */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
