/** Account persistence (repositories layer). The Prisma implementation is in prisma-repository.ts. */

export type Platform = 'web' | 'desktop' | 'android' | 'ios';

export interface UserRow {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  passwordHash: string;
  displayName: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface SessionRow {
  id: string;
  userId: string;
  platform: Platform;
  createdAt: Date;
  lastUsedAt: Date;
  ipHash: string;
  userAgentHash: string;
  revokedAt: Date | null;
}

export interface RefreshRow {
  id: string;
  sessionId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  replacedById: string | null;
  revokedAt: Date | null;
}

export interface EmailTokenRow {
  id: string;
  userId: string;
  type: 'verify' | 'reset';
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  result: 'ok' | 'fail' | 'blocked';
  ipHash: string;
  timestamp: Date;
}

export interface AuthRepository {
  createUser(user: UserRow): Promise<'ok' | 'exists'>;
  userById(id: string): Promise<UserRow | null>;
  userByEmail(email: string): Promise<UserRow | null>;
  updateUser(
    id: string,
    patch: Partial<Pick<UserRow, 'emailVerifiedAt' | 'passwordHash' | 'displayName'>>,
  ): Promise<void>;
  /** Hard delete: sessions, tokens and email tokens cascade; audit rows lose the user id. */
  deleteUser(id: string): Promise<void>;

  createSession(session: SessionRow, token: RefreshRow): Promise<void>;
  session(id: string): Promise<SessionRow | null>;
  sessions(userId: string): Promise<SessionRow[]>;
  touchSession(id: string, at: Date): Promise<void>;
  /** Revokes sessions (all of the user's when `sessionId` is omitted) and their refresh tokens. */
  revokeSessions(userId: string, at: Date, sessionId?: string): Promise<void>;

  refreshByHash(hash: string): Promise<RefreshRow | null>;
  /**
   * Marks `used` as used and inserts its successor atomically. False if it was already used
   * (a concurrent rotation won): the caller treats it as reuse.
   */
  rotateRefresh(usedId: string, at: Date, next: RefreshRow): Promise<boolean>;

  createEmailToken(token: EmailTokenRow): Promise<void>;
  /** Invalidates the user's unused tokens of that type (only the newest stays valid). */
  invalidateEmailTokens(userId: string, type: EmailTokenRow['type'], at: Date): Promise<void>;
  emailTokenByHash(hash: string): Promise<EmailTokenRow | null>;
  /** Marks it used; false if it was already used. */
  useEmailToken(id: string, at: Date): Promise<boolean>;

  audit(row: AuditRow): Promise<void>;
  auditFor(userId: string, limit: number): Promise<AuditRow[]>;
}

/** In-memory repository (tests, local development without Postgres). */
export class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, UserRow>();
  readonly sessionRows = new Map<string, SessionRow>();
  readonly refresh = new Map<string, RefreshRow>();
  readonly emailTokens = new Map<string, EmailTokenRow>();
  readonly auditRows: AuditRow[] = [];

  createUser(user: UserRow): Promise<'ok' | 'exists'> {
    if ([...this.users.values()].some((u) => u.email === user.email))
      return Promise.resolve('exists');
    this.users.set(user.id, { ...user });
    return Promise.resolve('ok');
  }
  userById(id: string): Promise<UserRow | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }
  userByEmail(email: string): Promise<UserRow | null> {
    return Promise.resolve([...this.users.values()].find((u) => u.email === email) ?? null);
  }
  updateUser(id: string, patch: Partial<UserRow>): Promise<void> {
    const u = this.users.get(id);
    if (u) this.users.set(id, { ...u, ...patch });
    return Promise.resolve();
  }
  deleteUser(id: string): Promise<void> {
    this.users.delete(id);
    for (const [sid, s] of this.sessionRows)
      if (s.userId === id) {
        this.sessionRows.delete(sid);
        for (const [rid, r] of this.refresh) if (r.sessionId === sid) this.refresh.delete(rid);
      }
    for (const [tid, t] of this.emailTokens) if (t.userId === id) this.emailTokens.delete(tid);
    for (const a of this.auditRows) if (a.userId === id) a.userId = null;
    return Promise.resolve();
  }
  createSession(session: SessionRow, token: RefreshRow): Promise<void> {
    this.sessionRows.set(session.id, { ...session });
    this.refresh.set(token.id, { ...token });
    return Promise.resolve();
  }
  session(id: string): Promise<SessionRow | null> {
    return Promise.resolve(this.sessionRows.get(id) ?? null);
  }
  sessions(userId: string): Promise<SessionRow[]> {
    return Promise.resolve([...this.sessionRows.values()].filter((s) => s.userId === userId));
  }
  touchSession(id: string, at: Date): Promise<void> {
    const s = this.sessionRows.get(id);
    if (s) s.lastUsedAt = at;
    return Promise.resolve();
  }
  revokeSessions(userId: string, at: Date, sessionId?: string): Promise<void> {
    for (const s of this.sessionRows.values())
      if (s.userId === userId && (sessionId === undefined || s.id === sessionId)) {
        s.revokedAt ??= at;
        for (const r of this.refresh.values()) if (r.sessionId === s.id) r.revokedAt ??= at;
      }
    return Promise.resolve();
  }
  refreshByHash(hash: string): Promise<RefreshRow | null> {
    return Promise.resolve([...this.refresh.values()].find((r) => r.tokenHash === hash) ?? null);
  }
  rotateRefresh(usedId: string, at: Date, next: RefreshRow): Promise<boolean> {
    const used = this.refresh.get(usedId);
    if (!used || used.usedAt) return Promise.resolve(false);
    used.usedAt = at;
    used.replacedById = next.id;
    this.refresh.set(next.id, { ...next });
    return Promise.resolve(true);
  }
  createEmailToken(token: EmailTokenRow): Promise<void> {
    this.emailTokens.set(token.id, { ...token });
    return Promise.resolve();
  }
  invalidateEmailTokens(userId: string, type: EmailTokenRow['type'], at: Date): Promise<void> {
    for (const t of this.emailTokens.values())
      if (t.userId === userId && t.type === type && !t.usedAt) t.usedAt = at;
    return Promise.resolve();
  }
  emailTokenByHash(hash: string): Promise<EmailTokenRow | null> {
    return Promise.resolve(
      [...this.emailTokens.values()].find((t) => t.tokenHash === hash) ?? null,
    );
  }
  useEmailToken(id: string, at: Date): Promise<boolean> {
    const t = this.emailTokens.get(id);
    if (!t || t.usedAt) return Promise.resolve(false);
    t.usedAt = at;
    return Promise.resolve(true);
  }
  audit(row: AuditRow): Promise<void> {
    this.auditRows.push({ ...row });
    return Promise.resolve();
  }
  auditFor(userId: string, limit: number): Promise<AuditRow[]> {
    return Promise.resolve(this.auditRows.filter((a) => a.userId === userId).slice(-limit));
  }
}
