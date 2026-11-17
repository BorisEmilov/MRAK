/**
 * Talent trees (UI task 14): a navigable grid per tree (mouse, arrow keys, gamepad focus), nodes
 * with icon and state, a tooltip with effect and cost, and a preview of the change before
 * confirming. Dark trees look different and warn about their Corruption and Debt.
 */
import type { LocaleKey } from '@mrak/content';
import { isNight, progressionRules, treeAccessCost, type TalentPreview } from '@mrak/core';
import { Button, IconGlyph, Tooltip, type IconName } from '@mrak/ui-kit';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { moveInGrid, progressionReasonKey, treeGrid } from './progression-ui';

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function TalentsTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const db = host.content;
  const rules = progressionRules(db);
  const calling = snapshot?.guardian.callingId
    ? db.find('callings', snapshot.guardian.callingId)
    : undefined;
  // Trees shown: owned ones, the calling's own, and dark trees (locked until a pact).
  const trees = useMemo(() => {
    if (!snapshot) return [];
    const ids = new Set([...snapshot.guardian.unlockedTrees, ...(calling?.trees ?? [])]);
    for (const tr of db.all('trees')) if (tr.kind === 'dark') ids.add(tr.id);
    return [...ids].flatMap((id) => db.find('trees', id) ?? []);
  }, [snapshot, calling, db]);
  const [treeId, setTreeId] = useState<string | null>(null);
  const [cell, setCell] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  if (!snapshot || !rules) return null;
  const tree = trees.find((tr) => tr.id === treeId) ?? trees[0];
  if (!tree) return null;
  const owned = snapshot.guardian.unlockedTrees.includes(tree.id);
  const layout = treeGrid(tree);
  const dark = tree.kind === 'dark';
  const selected = cell && layout.nodes.some((n) => n.cell === cell) ? cell : null;
  const preview: TalentPreview | null = selected ? host.previewTalent(tree.id, selected) : null;
  const access = treeAccessCost(snapshot, db, rules, tree.id);
  const revelation = snapshot.stats['revelation'] ?? 0;
  const night = isNight(snapshot);
  const talentName = (id: string) => t((db.find('talents', id)?.nameKey ?? id) as LocaleKey);
  const talentDesc = (id: string) => t((db.find('talents', id)?.descKey ?? id) as LocaleKey);

  const focusCell = (c: string): void => {
    setCell(c);
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${c}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const dir = ARROWS[e.key];
    if (!dir || !selected) return;
    e.preventDefault();
    focusCell(moveInGrid(layout.nodes, selected, dir[0], dir[1]));
  };
  const buy = (): void => {
    if (!preview) return;
    const r = host.dispatch({ type: 'buyTalent', tree: tree.id, cell: preview.cell });
    setMessage(
      r.ok
        ? t('talents.bought', { name: talentName(preview.talent) })
        : t(progressionReasonKey(r.reason)),
    );
  };
  const buyTree = (): void => {
    const r = host.dispatch({ type: 'buyTree', tree: tree.id });
    setMessage(
      r.ok
        ? t('talents.tree-bought', { name: t(tree.nameKey as LocaleKey) })
        : t(progressionReasonKey(r.reason)),
    );
  };

  return (
    <div className="talents" data-dark={dark || undefined}>
      <div className="talents-trees" role="group" aria-label={t('talents.choose-tree')}>
        {trees.map((tr) => (
          <Button
            key={tr.id}
            variant={tr.id === tree.id ? 'primary' : 'ghost'}
            icon={`tree.${tr.id}` as IconName}
            aria-pressed={tr.id === tree.id}
            onClick={() => {
              setTreeId(tr.id);
              setCell(null);
              setMessage(null);
            }}
          >
            {t(tr.nameKey as LocaleKey)}
            {!snapshot.guardian.unlockedTrees.includes(tr.id) && (
              <IconGlyph name="ui.locked" size={16} tone="inherit" />
            )}
          </Button>
        ))}
      </div>

      <header className="talents-header">
        <h3>
          <IconGlyph name={`tree.${tree.id}` as IconName} size={32} tone="inherit" />{' '}
          {t(tree.nameKey as LocaleKey)}
        </h3>
        <p>{t(tree.descKey as LocaleKey)}</p>
        <p className="talents-revelation">
          <IconGlyph name="resource.revelation" size={20} tone="inherit" />{' '}
          {t('talents.available', { value: revelation })}
        </p>
        {dark && (
          <p className="talents-dark-warning" role="note">
            <IconGlyph name="ui.warning" size={20} tone="inherit" /> {t('talents.dark-warning')}
          </p>
        )}
        {!owned && (
          <p className="talents-locked">
            {dark ? (
              t('talents.dark-locked')
            ) : access !== null ? (
              <Button
                variant="primary"
                icon="resource.revelation"
                {...(night
                  ? { disabledReason: t('progression.reason.night') }
                  : revelation < access
                    ? { disabledReason: t('progression.reason.revelation') }
                    : {})}
                onClick={buyTree}
              >
                {t('talents.buy-tree', { cost: access })}
              </Button>
            ) : null}
          </p>
        )}
      </header>

      <div className="talents-body">
        <div
          ref={grid}
          className="talents-grid"
          role="grid"
          aria-label={t(tree.nameKey as LocaleKey)}
          style={{ gridTemplateColumns: `repeat(${String(layout.columns)}, minmax(0, 1fr))` }}
          onKeyDown={onKey}
        >
          {Array.from({ length: layout.rows }, (_, row) => (
            <div key={row} role="row" className="talents-row" style={{ display: 'contents' }}>
              {Array.from({ length: layout.columns }, (_, col) => {
                const node = layout.nodes.find((n) => n.row === row && n.col === col);
                if (!node) return <div key={col} role="gridcell" className="talent-empty" />;
                const p = host.previewTalent(tree.id, node.cell);
                const status = p?.status ?? 'locked';
                const requiresText = node.requires.length
                  ? t('talents.requires', {
                      cells: node.requires
                        .map((r) => talentName(layout.nodes.find((n) => n.cell === r)?.talent ?? r))
                        .join(t('talents.or')),
                    })
                  : t('talents.entry');
                return (
                  <div key={col} role="gridcell" className="talent-cell">
                    {node.requires.length > 0 && (
                      <span className="talent-link" aria-hidden="true" />
                    )}
                    <Tooltip
                      title={talentName(node.talent)}
                      description={talentDesc(node.talent)}
                      extra={
                        <span>
                          {t('talents.cost', { cost: p?.cost ?? 0 })} · {requiresText}
                          {p?.reason ? ` · ${t(`talents.reason.${p.reason}` as LocaleKey)}` : ''}
                        </span>
                      }
                    >
                      <button
                        type="button"
                        className="talent-node"
                        data-cell={node.cell}
                        data-status={status}
                        data-selected={selected === node.cell || undefined}
                        aria-label={`${talentName(node.talent)} — ${t(`talents.status.${status}` as LocaleKey)}`}
                        tabIndex={
                          selected
                            ? selected === node.cell
                              ? 0
                              : -1
                            : node === layout.nodes[0]
                              ? 0
                              : -1
                        }
                        onFocus={() => {
                          setCell(node.cell);
                        }}
                        onClick={() => {
                          setCell(node.cell);
                          setMessage(null);
                        }}
                      >
                        <IconGlyph
                          name={`talent.${node.talent}` as IconName}
                          size={32}
                          tone="inherit"
                        />
                        <span className="talent-name">{talentName(node.talent)}</span>
                        <span className="talent-cost">
                          {status === 'owned'
                            ? t('talents.status.owned')
                            : t('talents.cost', { cost: p?.cost ?? 0 })}
                        </span>
                        {p?.ranked && p.rank > 0 && <span className="talent-rank">×{p.rank}</span>}
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <aside className="talent-preview" aria-live="polite">
          {preview ? (
            <>
              <h4>
                <IconGlyph name={`talent.${preview.talent}` as IconName} size={32} tone="inherit" />{' '}
                {talentName(preview.talent)}
              </h4>
              <p>{talentDesc(preview.talent)}</p>
              {preview.ranked && (
                <p className="items-hint">{t('talents.ranked', { rank: preview.rank })}</p>
              )}
              <dl className="talent-changes">
                <dt>{t('talents.change.revelation')}</dt>
                <dd>
                  {revelation} → {preview.status === 'owned' ? revelation : preview.revelationAfter}
                </dd>
                {preview.corruption > 0 && (
                  <>
                    <dt>{t('stat.corruption.name')}</dt>
                    <dd data-tone="bad">+{preview.corruption}</dd>
                  </>
                )}
                {preview.debt > 0 && (
                  <>
                    <dt>{t('character.tab.debt')}</dt>
                    <dd data-tone="bad">+{preview.debt}</dd>
                  </>
                )}
                {preview.notice > 0 && (
                  <>
                    <dt>{t('talents.change.notice')}</dt>
                    <dd data-tone="bad">{t('talents.change.notice-up')}</dd>
                  </>
                )}
              </dl>
              {preview.status === 'owned' ? (
                <p>{t('talents.status.owned')}</p>
              ) : (
                <Button
                  variant={dark ? 'danger' : 'primary'}
                  icon="resource.revelation"
                  irreversible
                  cost={[
                    {
                      icon: 'resource.revelation',
                      label: t('character.revelation'),
                      amount: preview.cost,
                    },
                    ...(preview.corruption > 0
                      ? [
                          {
                            icon: 'resource.corruption' as const,
                            label: t('stat.corruption.name'),
                            amount: -preview.corruption,
                          },
                        ]
                      : []),
                  ]}
                  {...(preview.reason
                    ? { disabledReason: t(`talents.reason.${preview.reason}` as LocaleKey) }
                    : {})}
                  onClick={buy}
                >
                  {t('talents.confirm', { name: talentName(preview.talent) })}
                </Button>
              )}
            </>
          ) : (
            <p className="items-empty">{t('talents.pick')}</p>
          )}
          {message && <p role="status">{message}</p>}
        </aside>
      </div>
    </div>
  );
}
