/**
 * Store (docs/systems/store.md, ADR 0010): checkout sessions, verified payment webhooks and
 * entitlements — the only source of truth for paid access. Access is granted ONLY by a verified,
 * de-duplicated webhook whose order is re-read from the provider API; the browser's return from
 * the checkout never grants anything. Refunds and chargebacks revoke; chargebacks also block new
 * purchases until reviewed.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuditRow } from '../auth/repository.js';

export const SKUS = ['full-game', 'collector'] as const;
export type Sku = (typeof SKUS)[number];
export const SOURCES = ['web', 'steam', 'ios', 'android'] as const;
export type Source = (typeof SOURCES)[number];
export const FULL_GAME: Sku = 'full-game';

export interface EntitlementRow {
  id: string;
  userId: string;
  sku: Sku;
  source: Source;
  status: 'active' | 'revoked';
  orderId: string;
  purchasedAt: Date;
  refundedAt: Date | null;
}

export interface CollectorNameRow {
  userId: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  updatedAt: Date;
}

/** Writes made while handling one webhook event (one transaction). */
export interface StoreTx {
  grant(row: EntitlementRow): Promise<void>;
  /** Revokes every entitlement of an order; returns the owners. */
  revokeOrder(source: Source, orderId: string, at: Date): Promise<string[]>;
  block(userId: string, reason: string, at: Date): Promise<void>;
}

export interface StoreRepo {
  entitlementsOf(userId: string): Promise<EntitlementRow[]>;
  /** Runs `effect` once per provider event id, atomically with recording the id. */
  once(
    eventId: string,
    type: string,
    at: Date,
    effect: (tx: StoreTx) => Promise<void>,
  ): Promise<boolean>;
  blocked(userId: string): Promise<boolean>;
  setCollectorName(row: CollectorNameRow): Promise<void>;
  /** GDPR erasure (purchases stay with the provider as the merchant of record). */
  eraseUser(userId: string): Promise<void>;
}

export class MemoryStoreRepo implements StoreRepo {
  readonly rows: EntitlementRow[] = [];
  readonly events = new Set<string>();
  readonly blocks = new Map<string, string>();
  readonly names = new Map<string, CollectorNameRow>();
  entitlementsOf(userId: string): Promise<EntitlementRow[]> {
    return Promise.resolve(this.rows.filter((r) => r.userId === userId).map((r) => ({ ...r })));
  }
  async once(id: string, _type: string, _at: Date, effect: (tx: StoreTx) => Promise<void>) {
    if (this.events.has(id)) return false;
    const staged: EntitlementRow[] = this.rows.map((r) => ({ ...r }));
    const blocks = new Map(this.blocks);
    await effect({
      grant: (row) => {
        if (
          !staged.some(
            (r) => r.source === row.source && r.orderId === row.orderId && r.sku === row.sku,
          )
        )
          staged.push({ ...row });
        return Promise.resolve();
      },
      revokeOrder: (source, orderId, at) => {
        const hit = staged.filter((r) => r.source === source && r.orderId === orderId);
        for (const r of hit) Object.assign(r, { status: 'revoked', refundedAt: at });
        return Promise.resolve(hit.map((r) => r.userId));
      },
      block: (userId, reason) => {
        blocks.set(userId, reason);
        return Promise.resolve();
      },
    });
    this.rows.splice(0, this.rows.length, ...staged);
    for (const [k, v] of blocks) this.blocks.set(k, v);
    this.events.add(id);
    return true;
  }
  blocked(userId: string): Promise<boolean> {
    return Promise.resolve(this.blocks.has(userId));
  }
  setCollectorName(row: CollectorNameRow): Promise<void> {
    this.names.set(row.userId, { ...row });
    return Promise.resolve();
  }
  eraseUser(userId: string): Promise<void> {
    this.names.delete(userId);
    this.blocks.delete(userId);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------- provider

export interface WebhookEvent {
  id: string;
  type: string;
  kind: 'purchase' | 'refund' | 'chargeback' | 'ignored';
  orderId: string | null;
}

export interface ProviderOrder {
  id: string;
  completed: boolean;
  userId: string | null;
  priceIds: string[];
  completedAt: Date;
}

export interface PaymentProvider {
  createCheckout(input: { userId: string; priceId: string }): Promise<{ id: string; url: string }>;
  /** The event when the signature and timestamp check out; null otherwise. */
  verifyWebhook(
    raw: Buffer,
    header: (name: string) => string | undefined,
    now: Date,
  ): WebhookEvent | null;
  /** The order as the provider's API reports it (never only the webhook body). */
  getOrder(id: string): Promise<ProviderOrder | null>;
}

// ---------------------------------------------------------------- signed content URLs

export interface ContentSigner {
  /** URL of one object valid for `seconds` (≤ 300). */
  sign(objectPath: string, seconds: number, now: Date): string;
}

/** Development/E2E signer: HMAC URLs served by GET /v1/content/files/:name (never production). */
export class LocalSigner implements ContentSigner {
  constructor(
    private readonly secret: string,
    private readonly baseUrl: string,
  ) {}
  private mac(name: string, exp: number): string {
    return createHmac('sha256', this.secret)
      .update(`${name}:${String(exp)}`)
      .digest('hex');
  }
  sign(objectPath: string, seconds: number, now: Date): string {
    const name = objectPath.split('/').pop() ?? '';
    const exp = Math.floor(now.getTime() / 1000) + seconds;
    return `${this.baseUrl}/v1/content/files/${encodeURIComponent(name)}?exp=${String(exp)}&sig=${this.mac(name, exp)}`;
  }
  verify(name: string, exp: number, sig: string, now: Date): boolean {
    if (!Number.isInteger(exp) || exp < Math.floor(now.getTime() / 1000)) return false;
    const want = Buffer.from(this.mac(name, exp));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}

export interface FullPackInfo {
  /** Object path in the bucket, e.g. "/paid-content/full/mrak-full-0.1.0.json". */
  path: string;
  version: string;
  sha256: string;
  bytes: number;
}

// ---------------------------------------------------------------- service

export const TICKET_SECONDS = 300;
const NAME = /^\p{L}[\p{L} '-]{0,30}\p{L}$/u;
/** First-pass filter; every name is also reviewed by a person in the studio before credits. */
const BLOCKED_WORDS = [
  'admin',
  'moderator',
  'nazi',
  'hitler',
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'fag',
];

export interface StoreDeps {
  repo: StoreRepo;
  provider: PaymentProvider | null;
  /** Server-side price ids per sku (never from the client). */
  prices: Partial<Record<Sku, string>>;
  signer: ContentSigner | null;
  fullPack: FullPackInfo | null;
  audit: (row: AuditRow) => Promise<void>;
  hashIp: (ip: string) => string;
  userExists: (userId: string) => Promise<boolean>;
  now: () => Date;
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'unverified' | 'owned' | 'blocked' | 'unavailable' };

export class Store {
  constructor(private readonly d: StoreDeps) {}

  private log(userId: string | null, action: string, result: AuditRow['result'], ip: string) {
    return this.d.audit({
      id: randomUUID(),
      userId,
      action,
      result,
      ipHash: this.d.hashIp(ip),
      timestamp: this.d.now(),
    });
  }

  eraseUser(userId: string): Promise<void> {
    return this.d.repo.eraseUser(userId);
  }

  async entitlements(userId: string): Promise<EntitlementRow[]> {
    return this.d.repo.entitlementsOf(userId);
  }

  /** Active skus; the collector's edition includes the full game. */
  async activeSkus(userId: string): Promise<Sku[]> {
    const skus = new Set(
      (await this.d.repo.entitlementsOf(userId))
        .filter((r) => r.status === 'active')
        .map((r) => r.sku),
    );
    if (skus.has('collector')) skus.add(FULL_GAME);
    return [...skus];
  }

  async checkout(userId: string, verified: boolean, sku: Sku, ip: string): Promise<CheckoutResult> {
    const price = this.d.prices[sku];
    if (!this.d.provider || !price) return { ok: false, reason: 'unavailable' };
    if (!verified) return { ok: false, reason: 'unverified' };
    if (await this.d.repo.blocked(userId)) {
      await this.log(userId, 'checkout', 'blocked', ip);
      return { ok: false, reason: 'blocked' };
    }
    const owned = await this.activeSkus(userId);
    if (owned.includes(sku)) return { ok: false, reason: 'owned' };
    const session = await this.d.provider.createCheckout({ userId, priceId: price });
    // The consent to immediate access and the waiver of withdrawal were given for this checkout.
    await this.log(userId, 'checkout-consent', 'ok', ip);
    return { ok: true, url: session.url };
  }

  /** 'invalid' → 400 (bad signature/time); otherwise 200, also for duplicates. */
  async webhook(
    raw: Buffer,
    header: (name: string) => string | undefined,
    ip: string,
  ): Promise<'invalid' | 'processed' | 'duplicate' | 'ignored'> {
    const provider = this.d.provider;
    const now = this.d.now();
    const ev = provider?.verifyWebhook(raw, header, now) ?? null;
    if (!provider || !ev) {
      await this.log(null, 'payment-webhook', 'fail', ip);
      return 'invalid';
    }
    if (ev.kind === 'ignored' || !ev.orderId) {
      const fresh = await this.d.repo.once(ev.id, ev.type, now, () => Promise.resolve());
      return fresh ? 'ignored' : 'duplicate';
    }
    const orderId = ev.orderId;
    if (ev.kind === 'purchase') {
      const order = await provider.getOrder(orderId);
      const skus = (order?.priceIds ?? [])
        .map((p) => SKUS.find((s) => this.d.prices[s] === p))
        .filter((s): s is Sku => s !== undefined);
      const userId = order?.userId ?? null;
      if (!order?.completed || !userId || skus.length === 0 || !(await this.d.userExists(userId))) {
        await this.log(userId, 'purchase', 'fail', ip);
        return 'ignored'; // not recorded: a later event for the same order can still grant
      }
      const fresh = await this.d.repo.once(ev.id, ev.type, now, async (tx) => {
        for (const sku of skus)
          await tx.grant({
            id: randomUUID(),
            userId,
            sku,
            source: 'web',
            status: 'active',
            orderId,
            purchasedAt: order.completedAt,
            refundedAt: null,
          });
      });
      if (fresh) await this.log(userId, 'purchase', 'ok', ip);
      return fresh ? 'processed' : 'duplicate';
    }
    let owners: string[] = [];
    const fresh = await this.d.repo.once(ev.id, ev.type, now, async (tx) => {
      owners = await tx.revokeOrder('web', orderId, now);
      if (ev.kind === 'chargeback') for (const u of owners) await tx.block(u, 'chargeback', now);
    });
    for (const u of owners) await this.log(u, ev.kind, 'ok', ip);
    return fresh ? 'processed' : 'duplicate';
  }

  /** Signed URL of the full pack; null without the entitlement or when not configured. */
  async fullPackTicket(
    userId: string,
  ): Promise<
    | { url: string; version: string; sha256: string; bytes: number; expiresAt: string }
    | 'forbidden'
    | 'unavailable'
  > {
    if (!(await this.activeSkus(userId)).includes(FULL_GAME)) return 'forbidden';
    const { signer, fullPack } = this.d;
    if (!signer || !fullPack) return 'unavailable';
    const now = this.d.now();
    return {
      url: signer.sign(fullPack.path, TICKET_SECONDS, now),
      version: fullPack.version,
      sha256: fullPack.sha256,
      bytes: fullPack.bytes,
      expiresAt: new Date(now.getTime() + TICKET_SECONDS * 1000).toISOString(),
    };
  }

  /** Collector's edition credits name: format + word filter now, a person approves later. */
  async collectorName(userId: string, name: string): Promise<'pending' | 'forbidden' | 'invalid'> {
    if (!(await this.activeSkus(userId)).includes('collector')) return 'forbidden';
    const clean = name.normalize('NFC').trim().replace(/\s+/g, ' ');
    const lower = clean.toLowerCase();
    if (!NAME.test(clean) || BLOCKED_WORDS.some((w) => lower.includes(w))) return 'invalid';
    await this.d.repo.setCollectorName({
      userId,
      name: clean,
      status: 'pending',
      updatedAt: this.d.now(),
    });
    return 'pending';
  }
}
