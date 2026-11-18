import { describe, expect, it } from 'vitest';
import { INSTALL_KEY, scrub, TelemetryService, type TelemetryBatch } from './telemetry';

function setup(opts: { consent?: boolean; sample?: number; failing?: boolean } = {}) {
  const sent: TelemetryBatch[] = [];
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  let consent = opts.consent ?? false;
  let n = 0;
  const t = new TelemetryService({
    send: (b) => {
      sent.push(b);
      return opts.failing ? Promise.reject(new Error('offline')) : Promise.resolve();
    },
    storage,
    consent: () => consent,
    build: '0.1.0',
    demo: () => true,
    sample: opts.sample ?? 1,
    now: () => 1000,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  return {
    t,
    sent,
    data,
    setConsent: (v: boolean) => {
      consent = v;
    },
  };
}

describe('TelemetryService', () => {
  it('without consent nothing is queued, stored or sent', async () => {
    const { t, sent, data } = setup();
    for (let i = 0; i < 100; i++) t.track('death', { zone: 'old-forest', cause: 'cold' });
    t.track('js-error', { key: 'TypeError', text: 'boom' });
    await t.flush();
    expect(t.pending()).toBe(0);
    expect(sent).toHaveLength(0);
    expect(data.size).toBe(0);
  });

  it('with consent: random install id, batches of ≤ 50, only id-like strings', async () => {
    const { t, sent, data } = setup({ consent: true });
    for (let i = 0; i < 19; i++) t.track('zone', { zone: 'village', n: 1 });
    t.track('death', { zone: 'Old Forest!', cause: 'cold', n: 2 });
    await Promise.resolve();
    expect(sent).toHaveLength(1); // 20 waiting → flush
    for (let i = 0; i < 60; i++) t.track('sample', { value: 50, n: 10 });
    await t.flush();
    expect(sent.reduce((sum, b) => sum + b.events.length, 0)).toBe(80);
    expect(sent.every((b) => b.events.length <= 50)).toBe(true);
    const install = data.get(INSTALL_KEY);
    expect(install).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0]).toMatchObject({ install, build: '0.1.0', demo: true });
    expect(sent[0]?.events.at(-1)).toEqual({ e: 'death', t: 0, cause: 'cold', n: 2 });
  });

  it('withdrawing consent drops the queue and deletes the install id', async () => {
    const { t, sent, data, setConsent } = setup({ consent: true });
    t.track('decision', { key: 'spare-stoyan', cause: 'yes' });
    setConsent(false);
    t.forget();
    await t.flush();
    expect(sent).toHaveLength(0);
    expect(data.has(INSTALL_KEY)).toBe(false);
  });

  it('sampling 0 sends nothing; a failed send is dropped, not retried', async () => {
    const off = setup({ consent: true, sample: 0 });
    off.t.track('death', { cause: 'cold' });
    await off.t.flush();
    expect(off.sent).toHaveLength(0);
    const failing = setup({ consent: true, failing: true });
    failing.t.track('death', { cause: 'cold' });
    await failing.t.flush();
    await failing.t.flush();
    expect(failing.sent).toHaveLength(1);
  });

  it('error text is scrubbed of e-mails, URLs, numbers and strings', () => {
    expect(scrub('Failed ana@mail.bg at https://x.y/a?token=9 "Ivan" line 42')).toBe(
      'Failed <email> at <url> <str> line #',
    );
  });
});
