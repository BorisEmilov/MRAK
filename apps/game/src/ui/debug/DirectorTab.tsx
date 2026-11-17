/**
 * Debug console → director (docs/systems/event-director.md → Implementation 7): the tension curve
 * against its target, and why each tick did what it did. Development-only: it shows hidden
 * truths (categories, hallucinations) the player never sees.
 */
import { hysteriaStage, type DirectorDecision, type Snapshot } from '@mrak/core';
import { useApp } from '../../state/hooks';
import { formatTime } from '../format';

const W = 380;
const H = 120;
const COLORS: Record<string, string> = {
  noise: '#8fb3d9',
  seed: '#e0b050',
  hallucination: '#d0607a',
};

function Curve({ log }: { log: readonly DirectorDecision[] }) {
  if (log.length < 2) return <p>No director ticks yet (the director runs at night).</p>;
  const x = (i: number) => (i / (log.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 4 - (v / 100) * (H - 8);
  const line = (k: 'tension' | 'target') =>
    log.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      width="100%"
      role="img"
      aria-label="Tension curve"
    >
      <rect x="0" y="0" width={W} height={H} fill="rgba(0,0,0,0.25)" />
      {log.map((d, i) =>
        i > 0 && d.night !== log[i - 1]?.night ? (
          <line key={`n${String(i)}`} x1={x(i)} x2={x(i)} y1={0} y2={H} stroke="#555" />
        ) : null,
      )}
      <path d={line('target')} fill="none" stroke="#888" strokeDasharray="4 3" />
      <path d={line('tension')} fill="none" stroke="#f0e6d0" strokeWidth="1.5" />
      {log.map((d, i) =>
        d.outcome === 'fired' ? (
          <circle
            key={String(d.at)}
            cx={x(i)}
            cy={y(d.tension)}
            r="3"
            fill={COLORS[d.category ?? ''] ?? '#fff'}
          >
            <title>
              {d.event} ({d.category})
            </title>
          </circle>
        ) : null,
      )}
    </svg>
  );
}

function reason(d: DirectorDecision): string {
  const p = `p ${d.p.toFixed(2)}${d.roll !== null ? ` · roll ${d.roll.toFixed(2)}` : ''}`;
  if (d.outcome !== 'fired') return `${d.outcome} · ${p} · ${String(d.candidates)} candidates`;
  const factors = Object.entries(d.factors)
    .filter(([, v]) => v !== 1)
    .map(([k, v]) => `${k} ×${v.toFixed(2)}`)
    .join(', ');
  return `${p} · of ${String(d.candidates)} · ${factors}`;
}

export function DirectorTab({ snapshot }: { snapshot: Snapshot }) {
  const { host } = useApp();
  const db = host.content;
  const dir = snapshot.director;
  const log = dir.log.slice(-72);
  const last = dir.log.at(-1);
  const rules = db.find('fear-rules', 'default');
  const hysteria = snapshot.stats['hysteria'] ?? 0;
  const mob = snapshot.hysteria.mob;
  const act = (command: Parameters<typeof host.dispatch>[0]): void => {
    host.dispatch(command);
  };
  return (
    <div className="debug-director">
      <p>
        tension <strong>{dir.tension.toFixed(1)}</strong>
        {last && (
          <>
            {' '}
            · {last.phase} (target {last.target.toFixed(0)})
          </>
        )}
        {dir.quietUntil !== null && <> · quiet until {formatTime(dir.quietUntil % 1440)}</>} ·
        sanity tier {snapshot.sanity.tier}
      </p>
      <p>
        hysteria {hysteria.toFixed(0)} ({rules ? hysteriaStage(hysteria, rules) : '-'})
        {mob && (
          <>
            {' '}
            · mob → {mob.target} ({mob.size}){mob.complicit ? ' · complicit' : ''}
          </>
        )}
      </p>
      <Curve log={log} />
      <p>
        <small>
          solid: tension · dashed: target · dots:{' '}
          <span style={{ color: COLORS['noise'] }}>noise</span>{' '}
          <span style={{ color: COLORS['seed'] }}>seed</span>{' '}
          <span style={{ color: COLORS['hallucination'] }}>hallucination</span>
        </small>
      </p>
      {mob && (
        <div className="debug-buttons">
          <button
            type="button"
            onClick={() => {
              act({ type: 'confrontMob', approach: 'calm' });
            }}
          >
            calm mob
          </button>
          <button
            type="button"
            onClick={() => {
              act({ type: 'confrontMob', approach: 'exploit' });
            }}
          >
            exploit mob
          </button>
        </div>
      )}
      <ol className="debug-log">
        {[...log].reverse().map((d) => (
          <li key={String(d.at)}>
            <code>{formatTime(d.at % 1440)}</code> {d.phase} t{d.tension.toFixed(0)}{' '}
            {d.event ? (
              <strong style={{ color: COLORS[d.category ?? ''] }}>{d.event}</strong>
            ) : null}{' '}
            <small>{reason(d)}</small>
          </li>
        ))}
      </ol>
      <h4>occurrences</h4>
      <ol className="debug-log">
        {[...dir.occurrences]
          .reverse()
          .slice(0, 12)
          .map((o) => (
            <li key={String(o.id)}>
              #{o.id} {formatTime(o.at % 1440)} {o.event}
              {o.hallucination ? ' (hallucination)' : ''}
              {o.examined.length > 0 ? ` · examined: ${o.examined.join(', ')}` : ''}
            </li>
          ))}
      </ol>
    </div>
  );
}
