/** Telemetry panel (docs/systems/telemetry.md → Studio panel). */
import { useEffect, useState } from 'react';
import { ApiError, telemetry, type TelemetryDashboard } from './api';

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : '—');
const num = (x: number | null) => (x === null ? '—' : String(x));

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="bar" aria-hidden="true">
      <span style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
    </span>
  );
}

/** Zone × night death counts; cell shade = share of the busiest cell. */
function DeathHeatmap({ d }: { d: TelemetryDashboard }) {
  const zones = [...new Set(d.deaths.map((x) => x.zone))].sort();
  const nights = [...new Set(d.deaths.map((x) => x.night))].sort((a, b) => a - b);
  const max = Math.max(1, ...d.deaths.map((x) => x.count));
  const at = (z: string, n: number) =>
    d.deaths.find((x) => x.zone === z && x.night === n)?.count ?? 0;
  if (zones.length === 0) return <p className="muted">No deaths recorded.</p>;
  return (
    <table className="table heat">
      <thead>
        <tr>
          <th>Zone \ night</th>
          {nights.map((n) => (
            <th key={n}>{n}</th>
          ))}
          <th>Causes</th>
        </tr>
      </thead>
      <tbody>
        {zones.map((z) => (
          <tr key={z}>
            <th>{z}</th>
            {nights.map((n) => {
              const c = at(z, n);
              return (
                <td
                  key={n}
                  style={{
                    background: c
                      ? `rgb(179 38 30 / ${String(0.12 + (0.78 * c) / max)})`
                      : undefined,
                  }}
                  title={`${z}, night ${String(n)}: ${String(c)}`}
                >
                  {c || ''}
                </td>
              );
            })}
            <td className="muted">
              {d.deathCauses
                .filter((x) => x.zone === z)
                .map((x) => `${x.cause} ${String(x.count)}`)
                .join(', ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TelemetryPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TelemetryDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    telemetry(days)
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof ApiError ? err.code : String(err));
      });
    return () => {
      live = false;
    };
  }, [days]);

  if (error) return <p className="notice bad">Telemetry unavailable: {error}</p>;
  if (!data) return <p className="muted">Loading telemetry…</p>;
  const start = data.funnel[0]?.installs ?? 0;
  const maxRoute = Math.max(1, ...data.routes.map((r) => r.count));
  return (
    <div className="analysis telemetry">
      <div className="toolbar">
        <label>
          Last{' '}
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
            }}
          >
            {[1, 7, 30, 90].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>{' '}
          days
        </label>
        <span className="muted">
          {data.installs} installs · {data.sessions} sessions · {data.rows} events · mean tension{' '}
          {num(data.meanTension)}
        </span>
      </div>

      <section>
        <h3>Demo funnel</h3>
        <table className="table">
          <tbody>
            {data.funnel.map((f) => (
              <tr key={f.step}>
                <th>{f.step}</th>
                <td>{f.installs}</td>
                <td>{pct(f.installs, start)}</td>
                <td className="wide">
                  <Bar value={f.installs} max={start} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Deaths</h3>
        <DeathHeatmap d={data} />
      </section>

      <section>
        <h3>Nights</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Night</th>
              <th>Completed</th>
              <th>Median min</th>
              <th>Mean min</th>
              <th>Mean tension</th>
              <th>Mean sanity</th>
            </tr>
          </thead>
          <tbody>
            {data.nights.map((n) => (
              <tr key={n.night}>
                <td>{n.night}</td>
                <td>{n.runs}</td>
                <td>{num(n.medianMinutes)}</td>
                <td>{num(n.meanMinutes)}</td>
                <td>{num(n.meanTension)}</td>
                <td>{num(n.meanSanity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Routes (zone → zone)</h3>
        <table className="table">
          <tbody>
            {data.routes.map((r) => (
              <tr key={`${r.from}>${r.to}`}>
                <td>
                  {r.from} → {r.to}
                </td>
                <td>{r.count}</td>
                <td className="wide">
                  <Bar value={r.count} max={maxRoute} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Decisions and mysteries</h3>
        <ul>
          {[...data.decisions, ...data.mysteries].map((x) => (
            <li key={`${x.key}|${x.cause}`}>
              <code>{x.key}</code> → {x.cause}: {x.count}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Most frequent errors</h3>
        <ul>
          {data.errors.map((e) => (
            <li key={`${e.key}|${e.text}`} className="error">
              <code>{e.key}</code> {e.text} — {e.count}× ({e.installs} installs)
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
