/** Builds the account service from its parts (server.ts in production, tests with fakes). */
import type { AuthDeps, AuthHttpConfig } from './controller.js';
import { ipHasher, LoginThrottle, type Counters, type HumanCheck } from './guards.js';
import { loadKeyStore } from './keys.js';
import type { Mailer } from './mailer.js';
import type { PwnedCheck } from './passwords.js';
import type { AuthRepository } from './repository.js';
import { AuthService, type AccountDataHook } from './service.js';
import { TokenIssuer } from './tokens.js';
import type { Request } from 'express';
import type { Limiter } from '../limits/limiter.js';
import type { Policies } from '../limits/policies.js';
import type { Authenticate } from '../routes/progress.js';

export interface AuthSetup {
  repo: AuthRepository;
  counters: Counters;
  mailer: Mailer;
  /** JSON array of private Ed25519 JWKs with `kid`; the first one signs. */
  jwtKeys: string;
  issuer: string;
  audience: string;
  appUrl: string;
  /** ≥ 32 random bytes: IP salts, keyed hashes. */
  secret: string;
  http: AuthHttpConfig;
  human: HumanCheck;
  pwned?: PwnedCheck;
  hooks?: readonly AccountDataHook[];
  /** Active skus of an account (store); none when the store is not wired. */
  entitlements?: (userId: string) => Promise<readonly string[]>;
  now?: () => Date;
  /** Shared limiter for the per-session refresh policy. */
  limits?: { limiter: Limiter; policies: Policies };
}

export interface Auth {
  deps: AuthDeps;
  jwks: { keys: unknown[] };
  /** Bearer authenticator for other routes (account progress). */
  authenticate: Authenticate;
  /** Verified `sub` of the bearer token (signature only, no DB): rate-limit key. */
  userOf: (req: Request) => Promise<string | null>;
}

const bearer = (req: Request): string | null =>
  /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.get('authorization') ?? '')?.[1] ?? null;

export async function buildAuth(s: AuthSetup): Promise<Auth> {
  const now = s.now ?? (() => new Date());
  const keys = await loadKeyStore(s.jwtKeys);
  const tokens = new TokenIssuer(keys, s.issuer, s.audience);
  const limits = s.limits;
  const service = new AuthService({
    repo: s.repo,
    tokens,
    mailer: s.mailer,
    counters: s.counters,
    throttle: new LoginThrottle(s.counters, () => now().getTime()),
    human: s.human,
    ...(s.pwned ? { pwned: s.pwned } : {}),
    hashIp: ipHasher(s.secret),
    secret: s.secret,
    appUrl: s.appUrl,
    now,
    ...(s.hooks ? { hooks: s.hooks } : {}),
    ...(limits
      ? {
          limitRefresh: (sessionId: string) =>
            limits.limiter.consume(
              `refresh-session:s:${sessionId}`,
              limits.policies['refresh-session'],
            ),
        }
      : {}),
  });
  return {
    deps: { service, http: s.http },
    jwks: keys.jwks,
    authenticate: async (req) => {
      const token = bearer(req);
      const p = token ? await service.authenticate(token) : null;
      return (
        p && {
          userId: p.userId,
          entitlements: s.entitlements ? await s.entitlements(p.userId) : [],
          verified: p.verified,
        }
      );
    },
    userOf: async (req) => {
      const token = bearer(req);
      return token ? ((await tokens.verify(token, now()))?.sub ?? null) : null;
    },
  };
}
