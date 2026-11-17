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
  | 'account-deleted';

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
