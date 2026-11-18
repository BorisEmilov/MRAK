/**
 * Outgoing account email. Links are built from the configured base URL, never the request Host
 * (reset-poisoning). Caps per recipient protect victims from email bombing (C-11).
 */
export type MailKind =
  | 'verify-email'
  | 'reset-password'
  | 'already-registered'
  | 'password-changed'
  | 'session-revoked-reuse'
  | 'account-deleted'
  | 'newsletter-confirm';

export interface Mail {
  to: string;
  kind: MailKind;
  /** Absolute link with the token, for verify/reset mails. */
  link?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Tests and local development: keeps mails in memory (never logged: they hold tokens). */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }
}

/**
 * Development/E2E only: appends each mail as a JSON line to `<dir>/outbox.jsonl` so tests can
 * follow verification links. server.ts refuses it in production (mails hold tokens).
 */
export class FileMailer implements Mailer {
  constructor(private readonly dir: string) {}
  async send(mail: Mail): Promise<void> {
    const { appendFile, mkdir } = await import('node:fs/promises');
    await mkdir(this.dir, { recursive: true });
    await appendFile(
      `${this.dir}/outbox.jsonl`,
      `${JSON.stringify({ ...mail, at: Date.now() })}\n`,
    );
  }
}

/** Minimal counter store the budget needs (guards.ts Counters satisfies it). */
interface DailyCounter {
  hit(key: string, windowMs: number): Promise<number>;
}

export type BudgetAlert = (event: { level: 50 | 80 | 100; sent: number; cap: number }) => void;

/**
 * Global daily email budget (C-11, C-39) and the `emails` emergency switch. Alerts once at 50 %
 * and 80 % of the cap; at 100 % mail is dropped (and alerted) until the next UTC day. Per-recipient
 * caps are applied by the account service before this.
 */
export class BudgetedMailer implements Mailer {
  constructor(
    private readonly inner: Mailer,
    private readonly counters: DailyCounter,
    private readonly dailyCap: number,
    private readonly enabled: () => Promise<boolean>,
    private readonly alert: BudgetAlert,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(mail: Mail): Promise<void> {
    if (!(await this.enabled())) return;
    const day = this.now().toISOString().slice(0, 10);
    const sent = await this.counters.hit(`mail:global:${day}`, 26 * 3600_000);
    const cap = this.dailyCap;
    if (sent > cap) {
      if (sent === cap + 1) this.alert({ level: 100, sent: cap, cap });
      return;
    }
    if (sent === Math.ceil(cap * 0.5)) this.alert({ level: 50, sent, cap });
    if (sent === Math.ceil(cap * 0.8)) this.alert({ level: 80, sent, cap });
    await this.inner.send(mail);
  }
}
