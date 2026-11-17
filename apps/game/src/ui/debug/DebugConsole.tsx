/**
 * Development-only debug console (F1). Not player-facing and never bundled in production
 * (lazy-imported behind `import.meta.env.DEV`), so its labels are plain developer English.
 * Every change goes through core commands — the console has no back door into the state.
 */
import { dayPhaseAt, jdnToJulian, type DayPhase } from '@mrak/core';
import { useMemo, useState } from 'react';
import { useApp, useUi } from '../../state/hooks';
import { formatTime } from '../format';
import { DirectorTab } from './DirectorTab';

type Tab = 'flags' | 'stats' | 'time' | 'events' | 'director' | 'log';

function minutesUntil(current: number, test: (minute: number) => boolean): number {
  for (let i = 1; i <= 1440; i++) {
    const m = (current + i) % 1440;
    if (test(m)) return i;
  }
  return 1440;
}

export default function DebugConsole() {
  const { host, store } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const events = useUi((s) => s.recentEvents);
  const fps = useUi((s) => s.fps);
  const [tab, setTab] = useState<Tab>('flags');
  const [filter, setFilter] = useState('');
  const [villager, setVillager] = useState('');
  const [message, setMessage] = useState('');
  const db = host.content;

  const villagers = useMemo(() => db.all('villagers').map((v) => v.id), [db]);
  const run = (label: string, fn: () => { ok: boolean; reason?: string }): void => {
    const r = fn();
    setMessage(r.ok ? `✔ ${label}` : `✘ ${label}: ${r.reason ?? ''}`);
  };

  const close = (): void => {
    store.setState({ debugOpen: false });
  };

  if (!snapshot) {
    return (
      <aside className="debug" aria-label="Debug console">
        <header>
          <strong>Debug</strong> <span>{fps} fps</span>
          <button type="button" onClick={close}>
            ×
          </button>
        </header>
        <p>Start or load a game to inspect it.</p>
      </aside>
    );
  }

  const month = jdnToJulian(snapshot.clock.day).month;
  const skipTo = (phase: DayPhase): void => {
    const minutes = minutesUntil(snapshot.clock.minute, (m) => dayPhaseAt(m, month) === phase);
    run(`to ${phase}`, () => host.dispatch({ type: 'advanceTime', minutes }));
  };
  const q = filter.toLowerCase();

  return (
    <aside className="debug" aria-label="Debug console">
      <header>
        <strong>Debug</strong>
        <span>
          {formatTime(snapshot.clock.minute)} · night {snapshot.calendar.nightIndex} · {fps} fps
        </span>
        <button type="button" onClick={close} aria-label="Close debug console">
          ×
        </button>
      </header>
      <nav>
        {(['flags', 'stats', 'time', 'events', 'director', 'log'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'active' : ''}
            onClick={() => {
              setTab(t);
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {(tab === 'flags' || tab === 'stats' || tab === 'events') && (
        <input
          placeholder="filter…"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
      )}
      <div className="debug-body">
        {tab === 'flags' &&
          db.registry.flags
            .filter((f) => f.id.includes(q))
            .map((f) => {
              const on = snapshot.flags[f.id] === true;
              return (
                <label key={f.id} title={f.description}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      run(f.id, () =>
                        host.dispatch({
                          type: 'applyEffects',
                          source: 'debug',
                          effects: [on ? { clearFlag: f.id } : { setFlag: f.id }],
                        }),
                      );
                    }}
                  />
                  {f.id}
                </label>
              );
            })}
        {tab === 'stats' && (
          <>
            <label>
              villager:{' '}
              <select
                value={villager}
                onChange={(e) => {
                  setVillager(e.target.value);
                }}
              >
                <option value="">(global stats)</option>
                {villagers.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {db.registry.stats
              .filter(
                (s) =>
                  (villager ? s.scope === 'villager' : s.scope !== 'villager') && s.id.includes(q),
              )
              .map((s) => {
                const value = villager
                  ? (snapshot.villagerStats[villager]?.[s.id] ?? s.default)
                  : (snapshot.stats[s.id] ?? s.default);
                return (
                  <label key={s.id} title={s.description} className="debug-stat">
                    <span>{s.id}</span>
                    <input
                      type="number"
                      min={s.min}
                      max={s.max}
                      step="any"
                      defaultValue={value}
                      key={`${s.id}-${String(value)}`}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isNaN(v) || v === value) return;
                        run(`${s.id} = ${String(v)}`, () =>
                          host.dispatch({
                            type: 'applyEffects',
                            source: 'debug',
                            effects: [
                              { setStat: s.id, value: v, ...(villager ? { villager } : {}) },
                            ],
                          }),
                        );
                      }}
                    />
                    <small>
                      [{s.min}, {s.max}]
                    </small>
                  </label>
                );
              })}
          </>
        )}
        {tab === 'time' && (
          <div className="debug-buttons">
            {[15, 60, 360, 1440].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  run(`+${String(m)} min`, () =>
                    host.dispatch({ type: 'advanceTime', minutes: m }),
                  );
                }}
              >
                +{m >= 60 ? `${String(m / 60)} h` : `${String(m)} min`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                store.setState({ debugLights: store.getState().debugLights + 20 });
                setMessage('✔ +20 lights around the guardian');
              }}
            >
              +20 lights
            </button>
            {(['dawn', 'day', 'dusk', 'night'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  skipTo(p);
                }}
              >
                to {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const minutes = minutesUntil(snapshot.clock.minute, (m) => m === 213);
                run('to 03:33', () => host.dispatch({ type: 'advanceTime', minutes }));
              }}
            >
              to 03:33
            </button>
          </div>
        )}
        {tab === 'events' &&
          db
            .all('events')
            .filter((e) => e.id.includes(q))
            .map((e) => (
              <button
                key={e.id}
                type="button"
                className="debug-row"
                onClick={() => {
                  run(`event ${e.id}`, () => host.dispatch({ type: 'triggerEvent', event: e.id }));
                }}
              >
                {e.id} <small>({e.category})</small>
              </button>
            ))}
        {tab === 'director' && <DirectorTab snapshot={snapshot} />}
        {tab === 'log' && (
          <ol className="debug-log">
            {[...events].reverse().map((e, i) => (
              <li key={String(events.length - i)}>
                <code>{e.type}</code> {JSON.stringify(e.payload)}
              </li>
            ))}
          </ol>
        )}
      </div>
      {message && <footer>{message}</footer>}
    </aside>
  );
}
