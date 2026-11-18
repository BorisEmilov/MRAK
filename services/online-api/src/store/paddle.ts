/**
 * Paddle Billing (merchant of record, ADR 0010): transactions API for checkout and order reads,
 * HMAC-SHA256 signed webhooks (`Paddle-Signature: ts=…;h1=…` over "<ts>:<raw body>").
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentProvider, ProviderOrder, WebhookEvent } from './store.js';

export const WEBHOOK_TOLERANCE_S = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PaddleOptions {
  apiKey: string;
  webhookSecret: string;
  /** https://sandbox-api.paddle.com (test mode) or https://api.paddle.com */
  apiUrl: string;
  /** Our checkout page (Paddle.js opens the transaction): https://mrak.game/buy/checkout/ */
  checkoutUrl: string;
  fetch?: typeof fetch;
}

interface PaddleTransaction {
  id: string;
  status: string;
  custom_data?: { user_id?: unknown } | null;
  items?: { price_id?: string; price?: { id?: string } }[];
  billed_at?: string | null;
  updated_at?: string;
}

export function paddleSignature(secret: string, ts: number, raw: Buffer | string): string {
  return `ts=${String(ts)};h1=${createHmac('sha256', secret)
    .update(`${String(ts)}:`)
    .update(raw)
    .digest('hex')}`;
}

export class PaddleProvider implements PaymentProvider {
  private readonly fetchFn: typeof fetch;
  constructor(private readonly o: PaddleOptions) {
    this.fetchFn = o.fetch ?? fetch;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.o.apiUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.o.apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok)
      throw new Error(`paddle ${path.split('/')[1] ?? ''} answered ${String(res.status)}`);
    return ((await res.json()) as { data: T }).data;
  }

  async createCheckout({ userId, priceId }: { userId: string; priceId: string }) {
    const txn = await this.api<PaddleTransaction>('/transactions', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        custom_data: { user_id: userId },
        collection_mode: 'automatic',
      }),
    });
    const url = new URL(this.o.checkoutUrl);
    url.searchParams.set('_ptxn', txn.id);
    return { id: txn.id, url: url.toString() };
  }

  verifyWebhook(
    raw: Buffer,
    header: (name: string) => string | undefined,
    now: Date,
  ): WebhookEvent | null {
    const sig = header('paddle-signature') ?? '';
    const parts = new Map(
      sig.split(';').map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), p.slice(i + 1)] as const;
      }),
    );
    const ts = Number(parts.get('ts'));
    const h1 = parts.get('h1') ?? '';
    if (!Number.isInteger(ts) || Math.abs(now.getTime() / 1000 - ts) > WEBHOOK_TOLERANCE_S)
      return null;
    const want = Buffer.from(
      paddleSignature(this.o.webhookSecret, ts, raw).split('h1=')[1] ?? '',
      'hex',
    );
    const got = Buffer.from(/^[0-9a-f]{64}$/.test(h1) ? h1 : '', 'hex');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    let body: { event_id?: unknown; event_type?: unknown; data?: Record<string, unknown> };
    try {
      body = JSON.parse(raw.toString('utf8')) as typeof body;
    } catch {
      return null;
    }
    if (
      typeof body.event_id !== 'string' ||
      typeof body.event_type !== 'string' ||
      body.event_id.length > 64
    )
      return null;
    const d = body.data ?? {};
    const base = { id: body.event_id, type: body.event_type.slice(0, 48) };
    if (body.event_type === 'transaction.completed' && typeof d['id'] === 'string')
      return { ...base, kind: 'purchase', orderId: d['id'] };
    if (
      (body.event_type === 'adjustment.created' || body.event_type === 'adjustment.updated') &&
      d['status'] === 'approved' &&
      typeof d['transaction_id'] === 'string'
    ) {
      if (d['action'] === 'chargeback')
        return { ...base, kind: 'chargeback', orderId: d['transaction_id'] };
      if (d['action'] === 'refund' && d['type'] !== 'partial')
        return { ...base, kind: 'refund', orderId: d['transaction_id'] };
    }
    return { ...base, kind: 'ignored', orderId: null };
  }

  async getOrder(id: string): Promise<ProviderOrder | null> {
    if (!/^txn_[a-z0-9]{1,60}$/.test(id)) return null;
    const t = await this.api<PaddleTransaction>(`/transactions/${id}`);
    const user = t.custom_data?.user_id;
    return {
      id: t.id,
      completed: t.status === 'completed',
      userId: typeof user === 'string' && UUID.test(user) ? user : null,
      priceIds: (t.items ?? []).map((i) => i.price?.id ?? i.price_id ?? '').filter(Boolean),
      completedAt: new Date(t.billed_at ?? t.updated_at ?? Date.now()),
    };
  }
}
