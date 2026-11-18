/**
 * Newsletter with double opt-in (data inventory: email + confirmation time only). Subscribing
 * always answers the same (no enumeration); the address joins only after the emailed link is
 * opened; unconfirmed addresses are deleted after 7 days; every mail carries an unsubscribe
 * link signed with HMAC (no stored token needed).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Counters, HumanCheck } from '../auth/guards.js';
import { isDisposableEmail } from '../auth/lists.js';
import type { Mailer } from '../auth/mailer.js';
import { keyedHash } from '../auth/guards.js';
import { newOpaqueToken, sha256, uuidv7 } from '../auth/tokens.js';

export const CONFIRM_TTL_MS = 48 * 3600_000;
export const UNCONFIRMED_TTL_MS = 7 * 24 * 3600_000;

export interface Subscriber {
  id: string;
  email: string;
  confirmedAt: Date | null;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
}

export interface NewsletterStore {
  byEmail(email: string): Promise<Subscriber | null>;
  byTokenHash(hash: string): Promise<Subscriber | null>;
  save(s: Subscriber): Promise<void>;
  remove(id: string): Promise<void>;
  /** Deletes unconfirmed subscribers created before `cutoff`. */
  purgeUnconfirmed(cutoff: Date): Promise<number>;
}

export class MemoryNewsletterStore implements NewsletterStore {
  readonly rows = new Map<string, Subscriber>();
  byEmail(email: string): Promise<Subscriber | null> {
    return Promise.resolve([...this.rows.values()].find((s) => s.email === email) ?? null);
  }
  byTokenHash(hash: string): Promise<Subscriber | null> {
    return Promise.resolve([...this.rows.values()].find((s) => s.tokenHash === hash) ?? null);
  }
  save(s: Subscriber): Promise<void> {
    this.rows.set(s.id, { ...s });
    return Promise.resolve();
  }
  remove(id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }
  purgeUnconfirmed(cutoff: Date): Promise<number> {
    let n = 0;
    for (const [id, s] of this.rows)
      if (!s.confirmedAt && s.createdAt < cutoff) {
        this.rows.delete(id);
        n += 1;
      }
    return Promise.resolve(n);
  }
}

export interface NewsletterDeps {
  store: NewsletterStore;
  mailer: Mailer;
  human: HumanCheck;
  counters: Counters;
  secret: string;
  /** Public site for links (https://mrak.game). */
  siteUrl: string;
  now: () => Date;
}

export class Newsletter {
  constructor(private readonly d: NewsletterDeps) {}

  /** HMAC of the subscriber id: the unsubscribe link needs no stored token. */
  unsubscribeSig(id: string): string {
    return createHmac('sha256', this.d.secret).update(`unsub:${id}`).digest('base64url');
  }

  /** Always resolves the same way for the caller; throws only for a failed human check. */
  async subscribe(rawEmail: string, captcha: string | undefined, ip: string): Promise<void> {
    if (!(await this.d.human(captcha, ip, 'newsletter'))) throw new Error('captcha');
    const email = rawEmail.trim().toLowerCase();
    if (isDisposableEmail(email)) return;
    const now = this.d.now();
    const existing = await this.d.store.byEmail(email);
    if (existing?.confirmedAt) return;
    const token = newOpaqueToken();
    await this.d.store.save({
      id: existing?.id ?? uuidv7(now.getTime()),
      email,
      confirmedAt: null,
      tokenHash: sha256(token),
      tokenExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
      createdAt: existing?.createdAt ?? now,
    });
    // Per-recipient cap shared with account mails (C-11); sent off the request path.
    const key = keyedHash(this.d.secret, email);
    void (async () => {
      if ((await this.d.counters.hit(`mail:h:${key}`, 3600_000)) > 3) return;
      await this.d.mailer.send({
        to: email,
        kind: 'newsletter-confirm',
        link: `${this.d.siteUrl}/newsletter/confirm#token=${token}`,
      });
    })().catch(() => undefined);
  }

  async confirm(token: string): Promise<boolean> {
    const s = await this.d.store.byTokenHash(sha256(token));
    const now = this.d.now();
    if (!s || !s.tokenExpiresAt || s.tokenExpiresAt <= now) return false;
    await this.d.store.save({ ...s, confirmedAt: now, tokenHash: null, tokenExpiresAt: null });
    return true;
  }

  /** Unknown ids and bad signatures are ignored silently (no oracle). */
  async unsubscribe(id: string, sig: string): Promise<void> {
    const expected = Buffer.from(this.unsubscribeSig(id));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return;
    await this.d.store.remove(id);
  }

  purge(): Promise<number> {
    return this.d.store.purgeUnconfirmed(new Date(this.d.now().getTime() - UNCONFIRMED_TTL_MS));
  }
}
