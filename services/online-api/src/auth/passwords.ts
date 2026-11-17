/**
 * Password hashing and policy (ASVS V2.1, V2.4). Argon2id with the OWASP parameters
 * m = 19 MiB, t = 2, p = 1; length 12–128 (Unicode code points), no composition rules,
 * common/trivial list, optional Have I Been Pwned k-anonymity check (fail-open).
 */
import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { COMMON_PASSWORDS, isTrivialPassword } from './lists.js';

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Max concurrent hashes per process: excess requests wait, then fail (protects CPU/RAM). */
const MAX_CONCURRENT = 8;
const MAX_WAITING = 64;
let running = 0;
const waiting: (() => void)[] = [];

export class HashBusyError extends Error {
  override readonly name = 'HashBusyError';
}

async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_WAITING) throw new HashBusyError('password hashing is saturated');
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

export function hashPassword(password: string): Promise<string> {
  return limited(() => argon2.hash(password, ARGON2_OPTIONS));
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return limited(async () => {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  });
}

/** A valid hash of a random secret: unknown accounts still pay one verify (anti-enumeration). */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= argon2.hash(
    createHash('sha256').update(String(Math.random())).digest('hex'),
    ARGON2_OPTIONS,
  );
  return dummy;
}

export function passwordLengthOk(password: string): boolean {
  const n = Array.from(password).length;
  return n >= PASSWORD_MIN && n <= PASSWORD_MAX;
}

/** Why a password is refused locally (null: acceptable). */
export function weakPassword(password: string, email: string): 'length' | 'common' | null {
  if (!passwordLengthOk(password)) return 'length';
  const p = password.toLowerCase();
  if (COMMON_PASSWORDS.has(p) || isTrivialPassword(p)) return 'common';
  const local = email.slice(0, email.indexOf('@'));
  if (local.length >= 4 && p.includes(local)) return 'common';
  return null;
}

/** Breached-password lookup by SHA-1 prefix; null when the service cannot answer. */
export type PwnedCheck = (password: string) => Promise<boolean | null>;

export function hibpCheck(fetchImpl: typeof fetch = fetch, timeoutMs = 2000): PwnedCheck {
  return async (password) => {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    try {
      const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const suffix = sha1.slice(5);
      return (await res.text())
        .split('\n')
        .some((line) => line.startsWith(suffix) && !line.trimEnd().endsWith(':0'));
    } catch {
      return null;
    }
  };
}
