/**
 * Telemetry panel data (docs/systems/telemetry.md → Studio panel): rows of `telemetry.events`
 * from the online database, aggregated here (pure, tested).
 */
export interface TelemetryRow {
  install: string;
  session: string;
  name: string;
  t: number;
  zone: string | null;
  key: string | null;
  cause: string | null;
  value: number | null;
  n: number | null;
  text: string | null;
  demo: boolean;
}

export const FUNNEL = ['session-start', 'prologue-end', 'demo-end', 'buy-click', 'purchase'];
export const MAX_ROWS = 200_000;

export interface TelemetryDashboard {
  rows: number;
  installs: number;
  sessions: number;
  funnel: { step: string; installs: number }[];
  deaths: { zone: string; night: number; count: number }[];
  deathCauses: { zone: string; cause: string; count: number }[];
  routes: { from: string; to: string; count: number }[];
  nights: {
    night: number;
    runs: number;
    medianMinutes: number | null;
    meanMinutes: number | null;
    meanTension: number | null;
    meanSanity: number | null;
  }[];
  meanTension: number | null;
  decisions: { key: string; cause: string; count: number }[];
  mysteries: { key: string; cause: string; count: number }[];
  errors: { key: string; text: string; count: number; installs: number }[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const round = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

function counter<T>(): { add: (k: string, v: T) => void; list: () => (T & { count: number })[] } {
  const m = new Map<string, T & { count: number }>();
  return {
    add: (k, v) => {
      const cur = m.get(k);
      if (cur) cur.count++;
      else m.set(k, { ...v, count: 1 });
    },
    list: () => [...m.values()].sort((a, b) => b.count - a.count),
  };
}

export function aggregate(rows: readonly TelemetryRow[]): TelemetryDashboard {
  const installsBy = new Map<string, Set<string>>();
  const deaths = counter<{ zone: string; night: number }>();
  const causes = counter<{ zone: string; cause: string }>();
  const routes = counter<{ from: string; to: string }>();
  const decisions = counter<{ key: string; cause: string }>();
  const mysteries = counter<{ key: string; cause: string }>();
  const errors = new Map<string, { key: string; text: string; count: number; who: Set<string> }>();
  const nights = new Map<number, { minutes: number[]; tension: number[]; sanity: number[] }>();
  const night = (n: number) => {
    let x = nights.get(n);
    if (!x) nights.set(n, (x = { minutes: [], tension: [], sanity: [] }));
    return x;
  };
  const lastZone = new Map<string, string>();
  const lastNight = new Map<string, number>();
  const tension: number[] = [];

  const ordered = [...rows].sort((a, b) =>
    a.session === b.session ? a.t - b.t : a.session < b.session ? -1 : 1,
  );
  for (const r of ordered) {
    let set = installsBy.get(r.name);
    if (!set) installsBy.set(r.name, (set = new Set()));
    set.add(r.install);
    switch (r.name) {
      case 'death': {
        const zone = r.zone ?? 'unknown';
        deaths.add(`${zone}|${String(r.n ?? 0)}`, { zone, night: r.n ?? 0 });
        causes.add(`${zone}|${r.cause ?? '?'}`, { zone, cause: r.cause ?? '?' });
        break;
      }
      case 'zone': {
        const prev = lastZone.get(r.session);
        if (r.zone && prev && prev !== r.zone)
          routes.add(`${prev}>${r.zone}`, { from: prev, to: r.zone });
        if (r.zone) lastZone.set(r.session, r.zone);
        if (r.n !== null) lastNight.set(r.session, r.n);
        break;
      }
      case 'night-start':
        if (r.n !== null) lastNight.set(r.session, r.n);
        break;
      case 'night-end':
        if (r.n !== null && r.value !== null) night(r.n).minutes.push(r.value / 60);
        break;
      case 'sample': {
        const n = lastNight.get(r.session) ?? 0;
        if (r.n !== null) {
          tension.push(r.n);
          night(n).tension.push(r.n);
        }
        if (r.value !== null) night(n).sanity.push(r.value);
        break;
      }
      case 'decision':
        decisions.add(`${r.key ?? ''}|${r.cause ?? ''}`, {
          key: r.key ?? '?',
          cause: r.cause ?? '?',
        });
        break;
      case 'mystery-end':
        mysteries.add(`${r.key ?? ''}|${r.cause ?? ''}`, {
          key: r.key ?? '?',
          cause: r.cause ?? '?',
        });
        break;
      case 'js-error': {
        const k = `${r.key ?? ''}|${r.text ?? ''}`;
        const e = errors.get(k) ?? {
          key: r.key ?? 'Error',
          text: r.text ?? '',
          count: 0,
          who: new Set<string>(),
        };
        e.count++;
        e.who.add(r.install);
        errors.set(k, e);
        break;
      }
      default:
        break;
    }
  }

  return {
    rows: rows.length,
    installs: new Set(rows.map((r) => r.install)).size,
    sessions: new Set(rows.map((r) => r.session)).size,
    funnel: FUNNEL.map((step) => ({ step, installs: installsBy.get(step)?.size ?? 0 })),
    deaths: deaths.list(),
    deathCauses: causes.list(),
    routes: routes.list().slice(0, 50),
    nights: [...nights.entries()]
      .sort(([a], [b]) => a - b)
      .map(([n, x]) => ({
        night: n,
        runs: x.minutes.length,
        medianMinutes: round(median(x.minutes)),
        meanMinutes: round(mean(x.minutes)),
        meanTension: round(mean(x.tension)),
        meanSanity: round(mean(x.sanity)),
      })),
    meanTension: round(mean(tension)),
    decisions: decisions.list().slice(0, 100),
    mysteries: mysteries.list(),
    errors: [...errors.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
      .map(({ who, ...e }) => ({ ...e, installs: who.size })),
  };
}

export interface TelemetrySource {
  rows(days: number): Promise<TelemetryRow[]>;
}

type Query = (text: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Reads the last `days` (≤ 90) of `telemetry.events`, at most MAX_ROWS rows. */
export function sqlTelemetry(query: Query): TelemetrySource {
  return {
    async rows(days) {
      const { rows } = await query(
        `SELECT install::text, session::text, name, t, zone, key, cause, value, n, text, demo
           FROM telemetry.events WHERE day >= current_date - $1::integer
           ORDER BY session, t LIMIT ${String(MAX_ROWS)}`,
        [Math.min(90, Math.max(1, Math.trunc(days)))],
      );
      return rows.map((r) => ({
        install: String(r['install']),
        session: String(r['session']),
        name: String(r['name']),
        t: Number(r['t']),
        zone: (r['zone'] as string | null) ?? null,
        key: (r['key'] as string | null) ?? null,
        cause: (r['cause'] as string | null) ?? null,
        value: r['value'] === null ? null : Number(r['value']),
        n: r['n'] === null ? null : Number(r['n']),
        text: (r['text'] as string | null) ?? null,
        demo: r['demo'] === true,
      }));
    },
  };
}
