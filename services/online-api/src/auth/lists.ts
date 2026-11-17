/**
 * Small built-in deny lists. Passwords shorter than 12 characters are already refused, so only
 * common long ones matter; patterns catch the rest. Update from public breach/disposable lists.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123123123123',
  '111111111111',
  '000000000000',
  '123456123456',
  'qwertyuiopas',
  'qwertyuiop123',
  'qwerty123456',
  '1qaz2wsx3edc',
  '1q2w3e4r5t6y',
  'zaq12wsxcde3',
  'asdfghjkl123',
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'p@ssw0rd1234',
  'iloveyou1234',
  'iloveyouiloveyou',
  'letmein12345',
  'welcome12345',
  'welcome123456',
  'administrator',
  'administrator1',
  'changeme1234',
  'trustno11234',
  'football1234',
  'baseball1234',
  'superman1234',
  'starwars1234',
  'princess1234',
  'sunshine1234',
  'monkey123456',
  'dragon123456',
  'master123456',
  'abc123456789',
  'abcdefghijkl',
  'abcd12345678',
  'qwerty123qwerty',
  'mrakmrakmrak',
  'mrak12345678',
]);

/** Repeated single character or a run of an ordered sequence (e.g. "aaaaaaaaaaaa"). */
export function isTrivialPassword(password: string): boolean {
  const p = password.toLowerCase();
  if (new Set(p).size <= 2) return true;
  const runs = [
    '0123456789012345678901234567890',
    'abcdefghijklmnopqrstuvwxyz',
    'qwertyuiopasdfghjklzxcvbnm',
  ];
  return runs.some((r) => r.includes(p) || Array.from(r).reverse().join('').includes(p));
}

export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '20minutemail.com',
  'discard.email',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'grr.la',
  'harakirimail.com',
  'inboxkitten.com',
  'mail.tm',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmail.net',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

/** True for a listed domain or any subdomain of one. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  const parts = domain.split('.');
  return parts.some((_, i) => DISPOSABLE_EMAIL_DOMAINS.has(parts.slice(i).join('.')));
}
