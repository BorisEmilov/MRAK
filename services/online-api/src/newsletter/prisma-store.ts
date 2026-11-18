/** PostgreSQL newsletter store (table newsletter_subscribers). */
import type { PrismaClient } from '../generated/prisma/client.js';
import type { NewsletterStore, Subscriber } from './newsletter.js';

export class PrismaNewsletterStore implements NewsletterStore {
  constructor(private readonly db: PrismaClient) {}
  byEmail(email: string): Promise<Subscriber | null> {
    return this.db.newsletterSubscriber.findUnique({ where: { email } });
  }
  byTokenHash(tokenHash: string): Promise<Subscriber | null> {
    return this.db.newsletterSubscriber.findUnique({ where: { tokenHash } });
  }
  async save(s: Subscriber): Promise<void> {
    await this.db.newsletterSubscriber.upsert({ where: { id: s.id }, create: s, update: s });
  }
  async remove(id: string): Promise<void> {
    await this.db.newsletterSubscriber.deleteMany({ where: { id } });
  }
  async purgeUnconfirmed(cutoff: Date): Promise<number> {
    const { count } = await this.db.newsletterSubscriber.deleteMany({
      where: { confirmedAt: null, createdAt: { lt: cutoff } },
    });
    return count;
  }
}
