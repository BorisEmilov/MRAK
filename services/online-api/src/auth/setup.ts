/** Builds the account service from its parts (server.ts in production, tests with fakes). */
import type { AuthDeps, AuthHttpConfig } from './controller.js';
import { ipHasher, LoginThrottle, type Counters, type HumanCheck } from './guards.js';
import { loadKeyStore } from './keys.js';
import type { Mailer } from './mailer.js';
import type { PwnedCheck } from './passwords.js';
import type { AuthRepository } from './repository.js';
import { AuthService, type AccountDataHook } from './service.js';
import { TokenIssuer } from './tokens.js';
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
  now?: () => Date;
}

export interface Auth {
  deps: AuthDeps;
  jwks: { keys: unknown[] };
  /** Bearer authenticator for other routes (account progress). */
  authenticate: Authenticate;
}

export async function buildAuth(s: AuthSetup): Promise<Auth> {
  const now = s.now ?? (() => new Date());
  const keys = await loadKeyStore(s.jwtKeys);
  const service = new AuthService({
    repo: s.repo,
    tokens: new TokenIssuer(keys, s.issuer, s.audience),
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
  });
  return {
    deps: { service, http: s.http },
    jwks: keys.jwks,
    authenticate: async (req) => {
      const m = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.get('authorization') ?? '');
      const p = m?.[1] ? await service.authenticate(m[1]) : null;
      return p && { userId: p.userId, entitlements: [], verified: p.verified };
    },
  };
}
