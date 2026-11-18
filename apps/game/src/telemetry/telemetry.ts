/**
 * Opt-in gameplay telemetry (docs/systems/telemetry.md). Nothing is queued or sent without the
 * `telemetry` option; the install id is random, never linked to an account, and deleted when
 * consent is withdrawn.
 */
import type { CoreEvent } from '@mrak/core';
import type { GameHost } from '../host/GameHost';
import type { UiStore } from '../state/ui-store';

export type TelemetryName =
  | 'session-start'
  | 'session-end'
  | 'game-start'
  | 'decision'
  | 'death'
  | 'mystery-start'
  | 'mystery-end'
  | 'zone'
  | 'sample'
  | 'night-start'
  | 'night-end'
  | 'chapter-end'
  | 'prologue-end'
  | 'demo-end'
  | 'buy-click'
  | 'purchase'
  | 'js-error';

export interface TelemetryFields {
  zone?: string;
  key?: string;
  cause?: string;
  value?: number;
  n?: number;
  text?: string;
}
export interface TelemetryEvent extends TelemetryFields {
  e: TelemetryName;
  t: number;
}
export interface TelemetryBatch {
  install: string;
  session: string;
  build: string;
  demo: boolean;
  events: TelemetryEvent[];
}

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;

export interface TelemetryDeps {
  send: (batch: TelemetryBatch, install: string) => Promise<void>;
  storage: KeyValue;
  consent: () => boolean;
  build: string;
  demo: () => boolean;
  /** 0–1 per install (VITE_TELEMETRY_SAMPLE). */
  sample: number;
  now?: () => number;
  uuid?: () => string;
}

export const INSTALL_KEY = 'mrak.telemetry.install.v1';
export const MAX_QUEUE = 200;
export const BATCH_SIZE = 50;
export const FLUSH_AT = 20;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Error text without URLs, e-mails, numbers or quoted strings (they may carry personal data). */
export function scrub(message: string): string {
  return message
    .replace(/\S+@\S+/g, '<email>')
    .replace(/[a-z][\w+.-]*:\/\/\S*/gi, '<url>')
    .replace(/(["'`]).*?\1/g, '<str>')
    .replace(/\d+/g, '#')
    .replace(/[@/]/g, ' ')
    .slice(0, 120);
}

export class TelemetryService {
  private queue: TelemetryEvent[] = [];
  private readonly started: number;
  private readonly session: string;
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor(private readonly deps: TelemetryDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
    this.started = this.now();
    this.session = this.uuid();
  }

  /** Session seconds so far. */
  elapsed(): number {
    return Math.round((this.now() - this.started) / 1000);
  }

  /** The install id, created on first use with consent; null without consent or when not sampled. */
  private install(): string | null {
    if (!this.deps.consent()) return null;
    let id: string | null = null;
    try {
      id = this.deps.storage?.getItem(INSTALL_KEY) ?? null;
      if (!id) {
        id = this.uuid();
        this.deps.storage?.setItem(INSTALL_KEY, id);
      }
    } catch {
      id ??= this.uuid(); // storage blocked: this session only
    }
    const bucket = parseInt(id.replace(/-/g, '').slice(0, 8), 16) / 0x1_0000_0000;
    return bucket < this.deps.sample ? id : null;
  }

  /** Queues an event; does nothing without consent. Non-id strings are left out. */
  track(e: TelemetryName, fields: TelemetryFields = {}): void {
    if (!this.install()) return;
    const ev: TelemetryEvent = { e, t: this.now() - this.started };
    for (const k of ['zone', 'cause'] as const) {
      const v = fields[k];
      if (v !== undefined && ID.test(v)) ev[k] = v;
    }
    if (fields.key !== undefined && /^[A-Za-z0-9][\w-]{0,63}$/.test(fields.key))
      ev.key = fields.key;
    if (fields.value !== undefined && Number.isFinite(fields.value)) ev.value = fields.value;
    if (fields.n !== undefined && Number.isFinite(fields.n)) ev.n = fields.n;
    if (e === 'js-error' && fields.text) ev.text = scrub(fields.text);
    this.queue.push(ev);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= FLUSH_AT) void this.flush();
  }

  pending(): number {
    return this.queue.length;
  }

  /** Sends what is queued in batches of ≤ 50; failures drop the batch. Nothing without consent. */
  async flush(): Promise<void> {
    const install = this.install();
    if (!install) {
      this.queue = [];
      return;
    }
    while (this.queue.length > 0) {
      const events = this.queue.splice(0, BATCH_SIZE);
      const batch: TelemetryBatch = {
        install,
        session: this.session,
        build: this.deps.build,
        demo: this.deps.demo(),
        events,
      };
      await this.deps.send(batch, install).catch(() => undefined);
    }
  }

  /** Consent withdrawn: drop the queue and forget the install id. */
  forget(): void {
    this.queue = [];
    try {
      this.deps.storage?.removeItem(INSTALL_KEY);
    } catch {
      // storage blocked: nothing stored
    }
  }
}

/** `fetch` sender for online-api (`keepalive` so the last batch survives `pagehide`). */
export function httpSender(apiUrl: string): TelemetryDeps['send'] {
  return async (batch, install) => {
    await fetch(`${apiUrl}/v1/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MRAK-Install': install },
      body: JSON.stringify(batch),
      keepalive: true,
      credentials: 'omit',
    });
  };
}

/** Maps core events, UI milestones and errors to telemetry (see the table in the spec). */
export function wireTelemetry(t: TelemetryService, host: GameHost, store: UiStore): void {
  let nightStart: number | null = null;
  let chapter: { id: string; at: number } | null = null;
  const zone = () => host.snapshot()?.currentZone ?? undefined;
  const night = () => host.snapshot()?.calendar.nightIndex;

  const track = (e: TelemetryName, fields: TelemetryFields = {}) => {
    t.track(e, fields);
  };
  const handle = (ev: CoreEvent): void => {
    switch (ev.type) {
      case 'guardian/created':
        track('game-start');
        break;
      case 'state/decisionRecorded':
        track('decision', { key: ev.payload.id, cause: ev.payload.choice });
        break;
      case 'pact/signed':
        track('decision', { key: ev.payload.pact, cause: 'signed' });
        break;
      case 'guardian/died': {
        const z = zone();
        const n = night();
        track('death', {
          cause: ev.payload.cause,
          ...(z ? { zone: z } : {}),
          ...(n !== undefined ? { n } : {}),
        });
        break;
      }
      case 'mystery/started':
        track('mystery-start', { key: ev.payload.mystery });
        break;
      case 'mystery/concluded':
        track('mystery-end', { key: ev.payload.mystery, cause: ev.payload.action });
        break;
      case 'mystery/unsolved':
        track('mystery-end', { key: ev.payload.mystery, cause: 'unsolved' });
        break;
      case 'world/zoneEntered': {
        const n = night();
        track('zone', { zone: ev.payload.zone, ...(n !== undefined ? { n } : {}) });
        break;
      }
      case 'night/started': {
        nightStart = Date.now();
        const n = night();
        track('night-start', n !== undefined ? { n } : {});
        break;
      }
      case 'night/completed':
        track('night-end', {
          n: ev.payload.day,
          ...(nightStart !== null ? { value: Math.round((Date.now() - nightStart) / 1000) } : {}),
        });
        nightStart = null;
        break;
      case 'state/flagSet':
        if (ev.payload.flag === 'prologue-complete') track('prologue-end', { value: t.elapsed() });
        break;
      default:
        break;
    }
  };
  host.subscribeEvents((events) => {
    for (const ev of events) handle(ev);
    const id = host.snapshot()?.calendar.chapterId ?? null;
    if (id !== (chapter?.id ?? null)) {
      if (chapter)
        track('chapter-end', {
          key: chapter.id,
          value: Math.round((Date.now() - chapter.at) / 1000),
        });
      chapter = id ? { id, at: Date.now() } : null;
    }
  });

  // Sanity and tension curves: one sample per minute of visible play.
  setInterval(() => {
    const s = host.snapshot();
    if (!s || store.getState().screen !== 'playing' || document.visibilityState !== 'visible')
      return;
    track('sample', {
      ...(s.currentZone ? { zone: s.currentZone } : {}),
      value: s.stats['sanity'] ?? 0,
      n: Math.round(s.director.tension),
    });
  }, 60_000);

  store.subscribe((s, prev) => {
    if (s.demoEnd && !prev.demoEnd) track('demo-end', { value: t.elapsed() });
    if (s.fullGame && !prev.fullGame) track('purchase');
    if (s.options.telemetry !== prev.options.telemetry) {
      if (s.options.telemetry) track('session-start');
      else t.forget();
    }
  });
  // Clicks on elements marked data-telemetry (e.g. the demo-end "Buy" link).
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest('[data-telemetry]');
    const name = el?.getAttribute('data-telemetry');
    if (name === 'buy-click') track('buy-click');
  });
  window.addEventListener('error', (e) => {
    track('js-error', {
      key: e.error instanceof Error ? e.error.name : 'Error',
      text: e.message,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    track('js-error', {
      key: r instanceof Error ? r.name : 'Rejection',
      text: r instanceof Error ? r.message : String(r),
    });
  });

  setInterval(() => void t.flush(), 30_000);
  window.addEventListener('pagehide', () => {
    track('session-end', { value: t.elapsed() });
    void t.flush();
  });
  track('session-start');
}
