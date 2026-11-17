/**
 * Relationship graph: villagers on a circle, bonds (gold) and grudges (red, dashed), thicker when
 * stronger. Focusing a villager highlights their ties. The list under it says the same in words
 * (the accessible equivalent of the picture).
 */
import type { LocaleKey } from '@mrak/content';
import type { VillagerView } from '@mrak/core';
import { useMemo, useState } from 'react';
import { t } from '../../i18n/t';
import { useApp } from '../../state/hooks';
import { portraitUrl } from './portrait';
import { affinityKey, edgesOf, layoutCircle, type EdgeFilter } from './village-ui';

const EDGE_FILTERS: readonly EdgeFilter[] = ['all', 'bonds', 'grudges'];
const STRENGTHS = [0, 20, 40, 60] as const;

export function RelationshipGraph({ views }: { views: readonly VillagerView[] }) {
  const { host } = useApp();
  const [filter, setFilter] = useState<EdgeFilter>('all');
  const [min, setMin] = useState<number>(0);
  const [focus, setFocus] = useState<string | null>(null);
  const nodes = useMemo(() => layoutCircle(views), [views]);
  const edges = useMemo(() => edgesOf(views, filter, min), [views, filter, min]);
  const at = new Map(nodes.map((n) => [n.id, n]));
  const name = (id: string): string =>
    t((host.content.find('villagers', id)?.nameKey ?? id) as LocaleKey);
  const shown = focus ? edges.filter((e) => e.a === focus || e.b === focus) : edges;

  return (
    <div className="relations">
      <div className="relations-controls" role="group" aria-label={t('village.graph.filters')}>
        {EDGE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="village-chip mrak-focusable"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
            }}
          >
            {t(`village.graph.${f}`)}
          </button>
        ))}
        <label className="relations-min">
          {t('village.graph.min')}
          <select
            value={min}
            onChange={(e) => {
              setMin(Number(e.target.value));
            }}
          >
            {STRENGTHS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? t('village.graph.any') : t(affinityKey(s))}
              </option>
            ))}
          </select>
        </label>
      </div>
      <svg
        className="relations-graph"
        viewBox="0 0 100 100"
        role="group"
        aria-label={t('village.graph.summary', { count: edges.length })}
      >
        {edges.map((e) => {
          const a = at.get(e.a);
          const b = at.get(e.b);
          if (!a || !b) return null;
          const dim = focus !== null && e.a !== focus && e.b !== focus;
          return (
            <line
              key={`${e.a}-${e.b}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="relations-edge"
              data-kind={e.value >= 0 ? 'bond' : 'grudge'}
              data-dim={dim || undefined}
              strokeWidth={0.4 + Math.abs(e.value) / 30}
            />
          );
        })}
        {nodes.map((n) => {
          const def = host.content.find('villagers', n.id);
          const src = def ? portraitUrl(n.id, def.look, 'living') : null;
          return (
            <g
              key={n.id}
              className="relations-node"
              data-dead={!n.alive || undefined}
              data-focus={focus === n.id || undefined}
              transform={`translate(${String(n.x)} ${String(n.y)})`}
              tabIndex={0}
              role="button"
              aria-label={name(n.id)}
              aria-pressed={focus === n.id}
              onClick={() => {
                setFocus(focus === n.id ? null : n.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setFocus(focus === n.id ? null : n.id);
                }
              }}
            >
              <circle r={6.5} />
              {src && (
                <image
                  href={src}
                  x={-5.5}
                  y={-5.5}
                  width={11}
                  height={11}
                  clipPath="circle(5.5px)"
                />
              )}
              {/* SVG user units: the graph is ~32rem wide for 100 units, so 3 ≈ 15 px. */}
              <text y={10.5} textAnchor="middle" fontSize={3}>
                {name(n.id)}
              </text>
            </g>
          );
        })}
      </svg>
      <h3 className="relations-list-title">
        {focus ? t('village.graph.ties-of', { name: name(focus) }) : t('village.graph.all-ties')}
      </h3>
      {shown.length === 0 ? (
        <p>{t('village.graph.none')}</p>
      ) : (
        <ul className="relations-list">
          {shown.map((e) => (
            <li key={`${e.a}-${e.b}`} data-kind={e.value >= 0 ? 'bond' : 'grudge'}>
              {[
                e.ab !== undefined
                  ? t('village.graph.tie', {
                      from: name(e.a),
                      to: name(e.b),
                      word: t(affinityKey(e.ab)),
                    })
                  : null,
                e.ba !== undefined
                  ? t('village.graph.tie', {
                      from: name(e.b),
                      to: name(e.a),
                      word: t(affinityKey(e.ba)),
                    })
                  : null,
              ]
                .filter((x): x is string => x !== null)
                .join(' · ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
