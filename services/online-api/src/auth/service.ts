/**
 * Account service (services layer): every account flow of docs/adr/0007-tokens.md and the threat
 * model (C-04 … C-14, C-34 … C-37). HTTP concerns (cookies, CSRF, status codes) live in the
 * controller; persistence in the repository.
 */
import {
  HashBusyError,
  dummyHash,
  hashPassword,
  verifyPassword,
  weakPassword,
  type PwnedCheck,
} from './passwords.js';
import { isDisposableEmail } from './lists.js';
import { keyedHash, type Counters, type HumanCheck, type LoginThrottle } from './guards.js';
import type { Mailer, MailKind } from './mailer.js';
import type {
  AuthRepository,
  AuditRow,
  Platform,
  RefreshRow,
  SessionRow,
  UserRow,
} from './repository.js';
import {
  ACCESS_TTL_S,
  REFRESH_ABSOLUTE_MS,
  REFRESH_SLIDING_MS,
  newOpaqueToken,
  sha256,
  uuidv7,
  type TokenIssuer,
} from './tokens.js';

export const VERIFY_TTL_MS = 24 * 3600_000;
export const RESET_TTL_MS = 30 * 60_000;
/** Mails per recipient (C-11): per hour and per day. */
export const MAIL_CAP = { hour: 3, day: 10 } as const;

export type AuthErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'
  | 'captcha_required'
  | 'weak_password'
  | 'email_not_allowed'
  | 'invalid_credentials'
  | 'invalid_token'
  | 'too_many_requests'
  | 'unavailable';

export class AuthError extends Error {
  override readonly name = 'AuthError';
  constructor(
    readonly code: AuthErrorCode,
    readonly retryAfterMs = 0,
  ) {
    super(code);
  }
}

/** Who is calling, as the controller sees it (no raw IP is stored). */
export interface RequestContext {
  ip: string;
  userAgent: string;
}

export interface Issued {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  /** When the refresh token stops sliding. */
  refreshExpiresAt: Date;
  /** Seconds until then (cookie Max-Age). */
  refreshMaxAge: number;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  createdAt: string;
}

export interface Principal {
  userId: string;
  sessionId: string;
  verified: boolean;
}

/** Other stores that hold account data (progress, saves…): export and erase with the account. */
export interface AccountDataHook {
  name: string;
  export(userId: string): Promise<unknown>;
  erase(userId: string): Promise<void>;
}

export interface AuthServiceDeps {
  repo: AuthRepository;
  tokens: TokenIssuer;
  mailer: Mailer;
  counters: Counters;
  throttle: LoginThrottle;
  human: HumanCheck;
  /** Optional breached-password check (HIBP k-anonymity). */
  pwned?: PwnedCheck;
  hashIp: (ip: string, now: Date) => string;
  /** Secret for keyed hashes of emails/user agents in counters and sessions. */
  secret: string;
  /** Base URL of the web app for links (never the request Host). */
  appUrl: string;
  now: () => Date;
  hooks?: readonly AccountDataHook[];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const publicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  emailVerified: u.emailVerifiedAt !== null,
  displayName: u.displayName,
  createdAt: u.createdAt.toISOString(),
});

export class AuthService {
  constructor(private readonly d: AuthServiceDeps) {}

  // ---------------------------------------------------------------- helpers

  private async audit(
    userId: string | null,
    action: string,
    result: AuditRow['result'],
    ctx: RequestContext,
  ): Promise<void> {
    const now = this.d.now();
    await this.d.repo.audit({
      id: uuidv7(now.getTime()),
      userId,
      action,
      result,
      ipHash: this.d.hashIp(ctx.ip, now),
      timestamp: now,
    });
  }

  private async human(
    token: string | undefined,
    ctx: RequestContext,
    action: string,
  ): Promise<void> {
    if (!(await this.d.human(token, ctx.ip, action))) throw new AuthError('captcha_required');
  }

  /** Sends unless the recipient hit the cap; never awaited by callers (constant response time). */
  private mail(to: string, kind: MailKind, link?: string): void {
    const key = keyedHash(this.d.secret, to);
    void (async () => {
      const hour = await this.d.counters.hit(`mail:h:${key}`, 3600_000);
      const day = await this.d.counters.hit(`mail:d:${key}`, 24 * 3600_000);
      if (hour > MAIL_CAP.hour || day > MAIL_CAP.day) return;
      await this.d.mailer.send({ to, kind, ...(link ? { link } : {}) });
    })().catch(() => undefined);
  }

  private async emailToken(user: UserRow, type: 'verify' | 'reset'): Promise<string> {
    const now = this.d.now();
    const token = newOpaqueToken();
    await this.d.repo.invalidateEmailTokens(user.id, type, now);
    await this.d.repo.createEmailToken({
      id: uuidv7(now.getTime()),
      userId: user.id,
      type,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + (type === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS)),
      usedAt: null,
    });
    return token;
  }

  private async checkNewPassword(password: string, email: string): Promise<void> {
    if (weakPassword(password, email)) throw new AuthError('weak_password');
    if ((await this.d.pwned?.(password)) === true) throw new AuthError('weak_password');
  }

  private async hash(password: string): Promise<string> {
    try {
      return await hashPassword(password);
    } catch (err) {
      if (err instanceof HashBusyError) throw new AuthError('unavailable');
      throw err;
    }
  }

  private async issue(
    user: UserRow,
    session: SessionRow,
    refresh: string,
    expiresAt: Date,
  ): Promise<Issued> {
    return {
      accessToken: await this.d.tokens.sign({ sub: user.id, sid: session.id }, this.d.now()),
      expiresIn: ACCESS_TTL_S,
      refreshToken: refresh,
      refreshExpiresAt: expiresAt,
      refreshMaxAge: Math.floor((expiresAt.getTime() - this.d.now().getTime()) / 1000),
      user: publicUser(user),
    };
  }

  // ---------------------------------------------------------------- registration

  /** Always the same answer and roughly the same time, whether or not the email is taken. */
  async register(
    input: { email: string; password: string; displayName?: string; captcha?: string },
    ctx: RequestContext,
  ): Promise<void> {
    await this.human(input.captcha, ctx, 'register');
    const email = normalizeEmail(input.email);
    if (isDisposableEmail(email)) throw new AuthError('email_not_allowed');
    await this.checkNewPassword(input.password, email);
    const now = this.d.now();
    const user: UserRow = {
      id: uuidv7(now.getTime()),
      email,
      emailVerifiedAt: null,
      passwordHash: await this.hash(input.password),
      displayName: input.displayName ?? null,
      createdAt: now,
      deletedAt: null,
    };
    if ((await this.d.repo.createUser(user)) === 'exists') {
      this.mail(email, 'already-registered', `${this.d.appUrl}/account/forgot-password`);
      await this.audit(null, 'register', 'fail', ctx);
      return;
    }
    const token = await this.emailToken(user, 'verify');
    this.mail(email, 'verify-email', `${this.d.appUrl}/account/verify#token=${token}`);
    await this.audit(user.id, 'register', 'ok', ctx);
  }

  async verifyEmail(token: string, ctx: RequestContext): Promise<void> {
    const row = await this.validEmailToken(token, 'verify');
    if (!(await this.d.repo.useEmailToken(row.id, this.d.now())))
      throw new AuthError('invalid_token');
    await this.d.repo.updateUser(row.userId, { emailVerifiedAt: this.d.now() });
    await this.audit(row.userId, 'verify-email', 'ok', ctx);
  }

  async resendVerification(
    input: { email: string; captcha?: string },
    ctx: RequestContext,
  ): Promise<void> {
    await this.human(input.captcha, ctx, 'resend');
    const user = await this.d.repo.userByEmail(normalizeEmail(input.email));
    if (!user || user.emailVerifiedAt) return;
    const token = await this.emailToken(user, 'verify');
    this.mail(user.email, 'verify-email', `${this.d.appUrl}/account/verify#token=${token}`);
  }

  private async validEmailToken(token: string, type: 'verify' | 'reset') {
    const row = await this.d.repo.emailTokenByHash(sha256(token));
    if (!row || row.type !== type || row.usedAt || row.expiresAt <= this.d.now())
      throw new AuthError('invalid_token');
    return row;
  }

  // ---------------------------------------------------------------- login and sessions

  async login(
    input: { email: string; password: string; platform: Platform; captcha?: string },
    ctx: RequestContext,
  ): Promise<Issued> {
    const email = normalizeEmail(input.email);
    const account = keyedHash(this.d.secret, email);
    const ip = this.d.hashIp(ctx.ip, this.d.now());
    const status = await this.d.throttle.status(account, ip);
    if (status.retryAfterMs > 0) throw new AuthError('too_many_requests', status.retryAfterMs);
    if (status.captcha) await this.human(input.captcha, ctx, 'login');
    const user = await this.d.repo.userByEmail(email);
    // Unknown accounts pay the same Argon2id verify (timing anti-enumeration).
    let ok: boolean;
    try {
      ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), input.password);
    } catch (err) {
      if (err instanceof HashBusyError) throw new AuthError('unavailable');
      throw err;
    }
    if (!user || !ok) {
      await this.d.throttle.failed(account, ip);
      await this.audit(user?.id ?? null, 'login', 'fail', ctx);
      throw new AuthError('invalid_credentials');
    }
    await this.d.throttle.succeeded(account);
    const now = this.d.now();
    const session: SessionRow = {
      id: uuidv7(now.getTime()),
      userId: user.id,
      platform: input.platform,
      createdAt: now,
      lastUsedAt: now,
      ipHash: ip,
      userAgentHash: keyedHash(this.d.secret, ctx.userAgent),
      revokedAt: null,
    };
    const refresh = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + REFRESH_SLIDING_MS);
    await this.d.repo.createSession(session, {
      id: uuidv7(now.getTime()),
      sessionId: session.id,
      familyId: uuidv7(now.getTime()),
      tokenHash: sha256(refresh),
      expiresAt,
      usedAt: null,
      replacedById: null,
      revokedAt: null,
    });
    await this.audit(user.id, 'login', 'ok', ctx);
    return this.issue(user, session, refresh, expiresAt);
  }

  /** Rotates the refresh token. A reused token revokes its family and session (C-14). */
  async refresh(token: string, ctx: RequestContext): Promise<Issued> {
    const now = this.d.now();
    const row = await this.d.repo.refreshByHash(sha256(token));
    if (!row) throw new AuthError('unauthorized');
    const session = await this.d.repo.session(row.sessionId);
    if (!session) throw new AuthError('unauthorized');
    if (row.usedAt) return this.reuse(session, ctx);
    if (row.revokedAt || session.revokedAt || row.expiresAt <= now)
      throw new AuthError('unauthorized');
    const absolute = session.createdAt.getTime() + REFRESH_ABSOLUTE_MS;
    if (absolute <= now.getTime()) throw new AuthError('unauthorized');
    const user = await this.d.repo.userById(session.userId);
    if (!user) throw new AuthError('unauthorized');
    const next = newOpaqueToken();
    const expiresAt = new Date(Math.min(now.getTime() + REFRESH_SLIDING_MS, absolute));
    const successor: RefreshRow = {
      id: uuidv7(now.getTime()),
      sessionId: session.id,
      familyId: row.familyId,
      tokenHash: sha256(next),
      expiresAt,
      usedAt: null,
      replacedById: null,
      revokedAt: null,
    };
    if (!(await this.d.repo.rotateRefresh(row.id, now, successor))) return this.reuse(session, ctx);
    await this.d.repo.touchSession(session.id, now);
    return this.issue(user, session, next, expiresAt);
  }

  private async reuse(session: SessionRow, ctx: RequestContext): Promise<never> {
    await this.d.repo.revokeSessions(session.userId, this.d.now(), session.id);
    await this.audit(session.userId, 'refresh-reuse', 'blocked', ctx);
    const user = await this.d.repo.userById(session.userId);
    if (user) this.mail(user.email, 'session-revoked-reuse');
    throw new AuthError('unauthorized');
  }

  /** Revokes the session of this refresh token (unknown tokens: nothing to do). */
  async logout(token: string | undefined, ctx: RequestContext): Promise<void> {
    if (!token) return;
    const row = await this.d.repo.refreshByHash(sha256(token));
    const session = row && (await this.d.repo.session(row.sessionId));
    if (!session) return;
    await this.d.repo.revokeSessions(session.userId, this.d.now(), session.id);
    await this.audit(session.userId, 'logout', 'ok', ctx);
  }

  async logoutAll(p: Principal, ctx: RequestContext): Promise<void> {
    await this.d.repo.revokeSessions(p.userId, this.d.now());
    await this.audit(p.userId, 'logout-all', 'ok', ctx);
  }

  /** Verifies an access token and that its session is still alive. */
  async authenticate(accessToken: string): Promise<Principal | null> {
    const claims = await this.d.tokens.verify(accessToken, this.d.now());
    if (!claims) return null;
    const session = await this.d.repo.session(claims.sid);
    if (!session || session.revokedAt || session.userId !== claims.sub) return null;
    const user = await this.d.repo.userById(claims.sub);
    if (!user) return null;
    return { userId: user.id, sessionId: session.id, verified: user.emailVerifiedAt !== null };
  }

  // ---------------------------------------------------------------- password recovery

  async forgotPassword(
    input: { email: string; captcha?: string },
    ctx: RequestContext,
  ): Promise<void> {
    await this.human(input.captcha, ctx, 'forgot');
    const user = await this.d.repo.userByEmail(normalizeEmail(input.email));
    if (!user) return;
    const token = await this.emailToken(user, 'reset');
    this.mail(user.email, 'reset-password', `${this.d.appUrl}/account/reset#token=${token}`);
    await this.audit(user.id, 'forgot-password', 'ok', ctx);
  }

  /** Sets a new password; every session is revoked; no automatic sign-in (C-35). */
  async resetPassword(
    input: { token: string; password: string },
    ctx: RequestContext,
  ): Promise<void> {
    const row = await this.validEmailToken(input.token, 'reset');
    const user = await this.d.repo.userById(row.userId);
    if (!user) throw new AuthError('invalid_token');
    await this.checkNewPassword(input.password, user.email);
    const passwordHash = await this.hash(input.password);
    if (!(await this.d.repo.useEmailToken(row.id, this.d.now())))
      throw new AuthError('invalid_token');
    await this.d.repo.updateUser(user.id, { passwordHash });
    await this.d.repo.revokeSessions(user.id, this.d.now());
    this.mail(user.email, 'password-changed');
    await this.audit(user.id, 'reset-password', 'ok', ctx);
  }

  // ---------------------------------------------------------------- the signed-in account

  private async user(p: Principal): Promise<UserRow> {
    const user = await this.d.repo.userById(p.userId);
    if (!user) throw new AuthError('unauthorized');
    return user;
  }

  async me(p: Principal): Promise<PublicUser> {
    return publicUser(await this.user(p));
  }

  async updateMe(p: Principal, patch: { displayName?: string | null }): Promise<PublicUser> {
    if (patch.displayName !== undefined)
      await this.d.repo.updateUser(p.userId, { displayName: patch.displayName });
    return this.me(p);
  }

  async sessions(p: Principal) {
    return (await this.d.repo.sessions(p.userId))
      .filter((s) => !s.revokedAt)
      .map((s) => ({
        id: s.id,
        platform: s.platform,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s.id === p.sessionId,
      }));
  }

  /** Only the owner's sessions: another user's id is "not found" (no IDOR oracle). */
  async revokeSession(p: Principal, sessionId: string, ctx: RequestContext): Promise<void> {
    const s = await this.d.repo.session(sessionId);
    if (!s || s.userId !== p.userId || s.revokedAt) throw new AuthError('not_found');
    await this.d.repo.revokeSessions(p.userId, this.d.now(), sessionId);
    await this.audit(p.userId, 'revoke-session', 'ok', ctx);
  }

  /** Re-authenticates with the current password (throttled like login). */
  private async reauth(user: UserRow, password: string, ctx: RequestContext): Promise<void> {
    const key = `reauth:${user.id}`;
    const ip = this.d.hashIp(ctx.ip, this.d.now());
    const status = await this.d.throttle.status(key, ip);
    if (status.retryAfterMs > 0) throw new AuthError('too_many_requests', status.retryAfterMs);
    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.d.throttle.failed(key, ip);
      await this.audit(user.id, 'reauth', 'fail', ctx);
      throw new AuthError('invalid_credentials');
    }
    await this.d.throttle.succeeded(key);
  }

  /** Changes the password and revokes every session, this one included. */
  async changePassword(
    p: Principal,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.user(p);
    await this.reauth(user, input.currentPassword, ctx);
    await this.checkNewPassword(input.newPassword, user.email);
    await this.d.repo.updateUser(user.id, { passwordHash: await this.hash(input.newPassword) });
    await this.d.repo.revokeSessions(user.id, this.d.now());
    this.mail(user.email, 'password-changed');
    await this.audit(user.id, 'change-password', 'ok', ctx);
  }

  /** GDPR export (Art. 15/20): everything stored about the account, without secrets. */
  async exportData(p: Principal): Promise<Record<string, unknown>> {
    const user = await this.user(p);
    const sessions = await this.d.repo.sessions(user.id);
    const extra: Record<string, unknown> = {};
    for (const h of this.d.hooks ?? []) extra[h.name] = await h.export(user.id);
    return {
      exportedAt: this.d.now().toISOString(),
      account: publicUser(user),
      sessions: sessions.map((s) => ({
        id: s.id,
        platform: s.platform,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString() ?? null,
      })),
      audit: (await this.d.repo.auditFor(user.id, 1000)).map((a) => ({
        action: a.action,
        result: a.result,
        timestamp: a.timestamp.toISOString(),
      })),
      ...extra,
    };
  }

  /** Real erasure (C-37): account data in every store; audit rows are kept without the user id. */
  async deleteAccount(p: Principal, password: string, ctx: RequestContext): Promise<void> {
    const user = await this.user(p);
    await this.reauth(user, password, ctx);
    for (const h of this.d.hooks ?? []) await h.erase(user.id);
    await this.d.repo.deleteUser(user.id);
    this.mail(user.email, 'account-deleted');
    await this.audit(null, 'delete-account', 'ok', ctx);
  }
}
