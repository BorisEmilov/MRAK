/** Studio views: dependency graph, villagers and relations, mysteries, analysis, history. */
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';
import { api, type Analysis, type Revision } from './api';

export type Open = (collection: string, id: string) => void;
const COLUMNS = ['mysteries', 'quests', 'events', 'pacts'];
const COLORS: Record<string, string> = {
  quests: '#c9a227',
  events: '#6c8ebf',
  mysteries: '#9b59b6',
  pacts: '#b03a2e',
};

/** Quests, events, mysteries and pacts; flag edges dashed (setter → reader), references solid. */
export function DependencyGraph({ analysis, onOpen }: { analysis: Analysis; onOpen: Open }) {
  const [only, setOnly] = useState<string>('all');
  const { nodes, edges } = useMemo(() => {
    const visible = analysis.graph.nodes.filter((n) => only === 'all' || n.collection === only);
    const keep = new Set(visible.map((n) => n.id));
    const rows: Record<string, number> = {};
    const nodes: Node[] = visible.map((n) => {
      const row = (rows[n.collection] = (rows[n.collection] ?? -1) + 1);
      return {
        id: n.id,
        position: { x: COLUMNS.indexOf(n.collection) * 280, y: row * 70 },
        data: { label: `${n.label}\n(${n.collection.slice(0, -1)})` },
        style: { borderColor: COLORS[n.collection] ?? '#888', whiteSpace: 'pre-line', width: 220 },
      };
    });
    const edges: Edge[] = analysis.graph.edges
      .filter((e) => keep.has(e.from) && keep.has(e.to))
      .map((e, i) => ({
        id: String(i),
        source: e.from,
        target: e.to,
        label: e.label,
        animated: e.kind === 'flag',
        style: e.kind === 'flag' ? { strokeDasharray: '4 3' } : {},
        markerEnd: { type: MarkerType.ArrowClosed },
      }));
    return { nodes, edges };
  }, [analysis, only]);
  return (
    <div className="graph-view">
      <div className="toolbar">
        {['all', ...COLUMNS].map((c) => (
          <button
            key={c}
            type="button"
            className={only === c ? 'on' : ''}
            onClick={() => {
              setOnly(c);
            }}
          >
            {c}
          </button>
        ))}
        <span className="muted">
          dashed = sets a flag the target reads · solid = direct reference · click to edit
        </span>
      </div>
      <div className="flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesConnectable={false}
          onNodeClick={(_e, n) => {
            const [c = '', id = ''] = n.id.split('/');
            onOpen(c, id);
          }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

/** Villagers in a circle; relationships as edges coloured by affinity. */
export function Villagers({ analysis, onOpen }: { analysis: Analysis; onOpen: Open }) {
  const vs = analysis.villagers;
  const nodes: Node[] = vs.map((v, i) => {
    const a = (2 * Math.PI * i) / Math.max(vs.length, 1);
    return {
      id: v.id,
      position: { x: 360 + 300 * Math.cos(a), y: 300 + 260 * Math.sin(a) },
      data: { label: v.name },
    };
  });
  const edges: Edge[] = vs.flatMap((v) =>
    v.relationships.map((r) => ({
      id: `${v.id}>${r.villager}`,
      source: v.id,
      target: r.villager,
      label: String(r.affinity),
      style: {
        stroke: r.affinity >= 0 ? '#3c9d5d' : '#c0392b',
        strokeWidth: 1 + Math.abs(r.affinity) / 30,
      },
      markerEnd: { type: MarkerType.ArrowClosed },
    })),
  );
  return (
    <div className="split">
      <div className="flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          onNodeClick={(_e, n) => {
            onOpen('villagers', n.id);
          }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Villager</th>
            <th>Home</th>
            <th>Work</th>
            <th>Relationships</th>
          </tr>
        </thead>
        <tbody>
          {vs.map((v) => (
            <tr key={v.id}>
              <td>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onOpen('villagers', v.id);
                  }}
                >
                  {v.name}
                </button>
              </td>
              <td>{JSON.stringify(v.home)}</td>
              <td>{JSON.stringify(v.work)}</td>
              <td>
                {v.relationships
                  .map((r) => `${r.villager} ${r.affinity >= 0 ? '+' : ''}${String(r.affinity)}`)
                  .join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Mysteries({ analysis, onOpen }: { analysis: Analysis; onOpen: Open }) {
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')
      : '—';
  return (
    <div className="cards">
      {analysis.mysteries.map((m) => (
        <section key={m.id} className="card">
          <h3>
            <button
              type="button"
              className="link"
              onClick={() => {
                onOpen('mysteries', m.id);
              }}
            >
              {m.name}
            </button>
          </h3>
          <p className="muted">Suspects: {list(m.suspects)}</p>
          <table className="table">
            <thead>
              <tr>
                <th>Clue</th>
                <th>Sources</th>
                <th>Supports</th>
                <th>Refutes</th>
              </tr>
            </thead>
            <tbody>
              {m.clues.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{list(c.sources)}</td>
                  <td>{list(c.supports)}</td>
                  <td>{list(c.refutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export function AnalysisPanel({ analysis, onOpen }: { analysis: Analysis; onOpen: Open }) {
  const errors = analysis.issues.filter((i) => i.severity === 'error');
  const warnings = analysis.issues.filter((i) => i.severity !== 'error');
  const groups = ['flag-never-set', 'maybe-unreachable', 'flag-never-read', 'flag-unused'];
  return (
    <div className="analysis">
      <section>
        <h3>
          Validation: {errors.length} errors · {warnings.length} warnings
        </h3>
        <ul>
          {[...errors, ...warnings].slice(0, 300).map((i, n) => (
            <li key={n} className={i.severity}>
              <code>{i.code}</code> {i.message}{' '}
              {i.file && <span className="muted">({i.file})</span>}
            </li>
          ))}
        </ul>
      </section>
      {groups.map((g) => {
        const items = analysis.findings.filter((f) => f.code === g);
        return (
          <section key={g}>
            <h3>
              {g} ({items.length})
            </h3>
            <ul>
              {items.map((f, n) => (
                <li key={n}>
                  {f.message}
                  {f.entity && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        if (f.entity) onOpen(f.entity.collection, f.entity.id);
                      }}
                    >
                      open
                    </button>
                  )}
                  {f.readers && (
                    <span className="muted">
                      {' '}
                      — read by {f.readers.map((r) => `${r.collection}/${r.id}`).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Versions of an entry and the field diff of each one against the previous. */
export function History({
  collection,
  id,
  version,
}: {
  collection: string;
  id: string;
  version: number;
}) {
  const [revs, setRevs] = useState<Revision[]>([]);
  const [diff, setDiff] = useState<{
    v: number;
    changes: { path: string; before: unknown; after: unknown }[];
  } | null>(null);
  useEffect(() => {
    void api.history(collection, id).then((r) => {
      setRevs(r.revisions);
    });
  }, [collection, id, version]);
  return (
    <div className="history">
      <h3>History</h3>
      <ul>
        {revs.map((r) => (
          <li key={r.version}>
            <button
              type="button"
              className="link"
              disabled={r.version === 1}
              onClick={() => {
                void api.diff(collection, id, r.version - 1, r.version).then((d) => {
                  setDiff({ v: r.version, changes: d.changes });
                });
              }}
            >
              v{r.version}
            </button>{' '}
            {r.status} · {r.author} · {new Date(r.createdAt).toLocaleString()}{' '}
            {r.note && <em>— {r.note}</em>}
          </li>
        ))}
      </ul>
      {diff && (
        <table className="table diff">
          <caption>
            v{diff.v - 1} → v{diff.v}
          </caption>
          <tbody>
            {diff.changes.length === 0 && (
              <tr>
                <td>Body unchanged (status change)</td>
              </tr>
            )}
            {diff.changes.map((c) => (
              <tr key={c.path}>
                <td>
                  <code>{c.path}</code>
                </td>
                <td className="before">{JSON.stringify(c.before)}</td>
                <td className="after">{JSON.stringify(c.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
