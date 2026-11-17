/** PostgreSQL account repository (tables users, sessions, refresh_tokens, email_tokens, audit_log). */
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type {
  AuditRow,
  AuthRepository,
  EmailTokenRow,
  Platform,
  RefreshRow,
  SessionRow,
  UserRow,
} from './repository.js';

const session = (s: Omit<SessionRow, 'platform'> & { platform: string }): SessionRow => ({
  ...s,
  platform: s.platform as Platform,
});

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly db: PrismaClient) {}

  async createUser(user: UserRow): Promise<'ok' | 'exists'> {
    try {
      await this.db.user.create({ data: user });
      return 'ok';
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        return 'exists';
      throw err;
    }
  }
  userById(id: string): Promise<UserRow | null> {
    return this.db.user.findUnique({ where: { id } });
  }
  userByEmail(email: string): Promise<UserRow | null> {
    return this.db.user.findUnique({ where: { email } });
  }
  async updateUser(id: string, patch: Partial<UserRow>): Promise<void> {
    await this.db.user.update({ where: { id }, data: patch });
  }
  async deleteUser(id: string): Promise<void> {
    await this.db.$transaction([
      this.db.auditLog.updateMany({ where: { userId: id }, data: { userId: null } }),
      this.db.user.delete({ where: { id } }),
    ]);
  }
  async createSession(s: SessionRow, token: RefreshRow): Promise<void> {
    await this.db.$transaction([
      this.db.session.create({ data: s }),
      this.db.refreshToken.create({ data: token }),
    ]);
  }
  async session(id: string): Promise<SessionRow | null> {
    const s = await this.db.session.findUnique({ where: { id } });
    return s && session(s);
  }
  async sessions(userId: string): Promise<SessionRow[]> {
    return (
      await this.db.session.findMany({
        where: { userId },
        orderBy: { lastUsedAt: 'desc' },
        take: 100,
      })
    ).map(session);
  }
  async touchSession(id: string, at: Date): Promise<void> {
    await this.db.session.update({ where: { id }, data: { lastUsedAt: at } });
  }
  async revokeSessions(userId: string, at: Date, sessionId?: string): Promise<void> {
    const where = { userId, revokedAt: null, ...(sessionId ? { id: sessionId } : {}) };
    await this.db.$transaction([
      this.db.refreshToken.updateMany({
        where: { session: where, revokedAt: null },
        data: { revokedAt: at },
      }),
      this.db.session.updateMany({ where, data: { revokedAt: at } }),
    ]);
  }
  refreshByHash(tokenHash: string): Promise<RefreshRow | null> {
    return this.db.refreshToken.findUnique({ where: { tokenHash } });
  }
  async rotateRefresh(usedId: string, at: Date, next: RefreshRow): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      // Conditional update: only one concurrent rotation can win.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: usedId, usedAt: null },
        data: { usedAt: at, replacedById: next.id },
      });
      if (count === 0) return false;
      await tx.refreshToken.create({ data: next });
      return true;
    });
  }
  async createEmailToken(token: EmailTokenRow): Promise<void> {
    await this.db.emailToken.create({ data: token });
  }
  async invalidateEmailTokens(
    userId: string,
    type: EmailTokenRow['type'],
    at: Date,
  ): Promise<void> {
    await this.db.emailToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: at },
    });
  }
  async emailTokenByHash(tokenHash: string): Promise<EmailTokenRow | null> {
    const t = await this.db.emailToken.findUnique({ where: { tokenHash } });
    return t && { ...t, type: t.type as EmailTokenRow['type'] };
  }
  async useEmailToken(id: string, at: Date): Promise<boolean> {
    const { count } = await this.db.emailToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: at },
    });
    return count === 1;
  }
  async audit(row: AuditRow): Promise<void> {
    await this.db.auditLog.create({ data: row });
  }
  async auditFor(userId: string, limit: number): Promise<AuditRow[]> {
    return (
      await this.db.auditLog.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: limit,
      })
    ).map((a) => ({ ...a, result: a.result as AuditRow['result'] }));
  }
}
