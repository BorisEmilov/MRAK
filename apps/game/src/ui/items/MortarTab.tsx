/**
 * The mortar (docs/systems/alchemy.md → Implementation): pick up to four ingredients, grind,
 * learn recipes by trying; failures and successes are written in the journal of experiments.
 */
import type { LocaleKey } from '@mrak/content';
import { itemRules, triedBefore, type CoreEvent, type Snapshot } from '@mrak/core';
import { Button, IconGlyph } from '@mrak/ui-kit';
import { useState } from 'react';
import { formatTime } from '../format';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { itemIcon, mortarCandidates, reasonKey } from './items-ui';

interface Slot {
  item: string;
  qty: number;
}

export function MortarTab() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const [mortar, setMortar] = useState<Slot[]>([]);
  const [result, setResult] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  const db = host.content;
  const rules = itemRules(db);
  if (!snapshot || !rules) return null;
  const { maxIngredients, maxQty } = rules.alchemy;
  const itemName = (id: string): string => t((db.find('items', id)?.nameKey ?? id) as LocaleKey);
  const candidates = mortarCandidates(snapshot, db);
  const have = (id: string): number => candidates.find((c) => c.item.id === id)?.qty ?? 0;
  const list = (slots: readonly { item: string; qty: number }[]): string =>
    slots.map((s) => `${String(s.qty)} ${itemName(s.item)}`).join(', ');
  const resultOf = (a: Snapshot['alchemy']['attempts'][number]): string =>
    a.recipe
      ? t((db.find('recipes', a.recipe)?.nameKey ?? a.recipe) as LocaleKey)
      : t(`items.mortar.hint.${a.hint ?? 'nothing'}` as LocaleKey);

  const add = (id: string): void => {
    setResult(null);
    setMortar((m) => {
      const existing = m.find((s) => s.item === id);
      if (existing)
        return m.map((s) =>
          s.item === id ? { ...s, qty: Math.min(maxQty, have(id), s.qty + 1) } : s,
        );
      return m.length >= maxIngredients ? m : [...m, { item: id, qty: 1 }];
    });
  };
  const change = (id: string, delta: number): void => {
    setResult(null);
    setMortar((m) =>
      m
        .map((s) => (s.item === id ? { ...s, qty: Math.min(maxQty, have(id), s.qty + delta) } : s))
        .filter((s) => s.qty > 0),
    );
  };
  const previous = [...snapshot.alchemy.attempts]
    .reverse()
    .find(
      (a) => mortar.length > 0 && triedBefore({ ...snapshot, alchemy: { attempts: [a] } }, mortar),
    );

  const grind = (): void => {
    const outcome = host.dispatch({ type: 'grind', ingredients: mortar });
    if (!outcome.ok) {
      const { key, item } = reasonKey(outcome.reason);
      setResult({ text: t(key, item ? { item: itemName(item) } : {}), tone: 'bad' });
      return;
    }
    setMortar([]);
    setResult(describe(outcome.events));
  };
  const describe = (events: readonly CoreEvent[]): { text: string; tone: 'good' | 'bad' } => {
    const lines: string[] = [];
    let tone: 'good' | 'bad' = 'bad';
    for (const e of events) {
      if (e.type === 'alchemy/failed') {
        lines.push(t(`items.mortar.hint.${e.payload.hint}` as LocaleKey), t('items.mortar.lost'));
      }
      if (e.type === 'alchemy/discovered') {
        tone = 'good';
        lines.push(
          t('items.mortar.discovered', {
            name: t((db.find('recipes', e.payload.recipe)?.nameKey ?? '') as LocaleKey),
          }),
        );
      }
      if (e.type === 'alchemy/brewed') {
        tone = 'good';
        const recipe = db.find('recipes', e.payload.recipe);
        const outputs = (recipe?.outputs ?? []).map((o, i) => ({
          item: o.item,
          qty:
            o.qty +
            (i === 0
              ? e.payload.doses - (recipe?.outputs ?? []).reduce((a, b) => a + b.qty, 0)
              : 0),
        }));
        lines.push(t('items.mortar.success', { outputs: list(outputs) }));
      }
    }
    return { text: lines.join(' '), tone };
  };

  const known = snapshot.guardian.unlockedRecipes.flatMap((id) => db.find('recipes', id) ?? []);
  const attempts = [...snapshot.alchemy.attempts].reverse();

  return (
    <div className="items-tab items-mortar">
      <p className="items-hint">{t('items.mortar.hint')}</p>
      <div className="items-columns">
        <section aria-labelledby="mortar-have">
          <h3 id="mortar-have">{t('items.mortar.available')}</h3>
          {candidates.length === 0 ? (
            <p className="items-empty">{t('items.mortar.none')}</p>
          ) : (
            <ul className="mortar-candidates">
              {candidates.map(({ item, qty }) => (
                <li key={item.id}>
                  <Button
                    variant="ghost"
                    icon={itemIcon(item)}
                    aria-label={t('items.mortar.add', { item: itemName(item.id) })}
                    {...(mortar.length >= maxIngredients && !mortar.some((s) => s.item === item.id)
                      ? { disabledReason: t('items.reason.ingredients') }
                      : {})}
                    onClick={() => {
                      add(item.id);
                    }}
                  >
                    {itemName(item.id)} · {t('items.mortar.have', { qty })}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mortar-bowl" aria-labelledby="mortar-in">
          <h3 id="mortar-in">
            <IconGlyph name="ui.mortar" size={24} tone="inherit" /> {t('items.mortar.in')}
          </h3>
          {mortar.length === 0 ? (
            <p className="items-empty">{t('items.mortar.empty')}</p>
          ) : (
            <ul>
              {mortar.map((s) => (
                <li key={s.item}>
                  <IconGlyph name={itemIcon(db.get('items', s.item))} size={20} tone="inherit" />{' '}
                  <strong>{s.qty}</strong> {itemName(s.item)}{' '}
                  <Button
                    variant="ghost"
                    aria-label={t('items.mortar.less', { item: itemName(s.item) })}
                    onClick={() => {
                      change(s.item, -1);
                    }}
                  >
                    {t('items.mortar.minus')}
                  </Button>
                  <Button
                    aria-label={t('items.mortar.more', { item: itemName(s.item) })}
                    variant="ghost"
                    {...(s.qty >= Math.min(maxQty, have(s.item))
                      ? { disabledReason: t('items.reason.ingredients') }
                      : {})}
                    onClick={() => {
                      change(s.item, 1);
                    }}
                  >
                    {t('items.mortar.plus')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {previous && (
            <p className="items-warning" role="status">
              {t('items.mortar.tried', { result: resultOf(previous) })}
            </p>
          )}
          <div className="items-actions">
            <Button
              variant="primary"
              icon="ui.mortar"
              {...(mortar.length === 0 ? { disabledReason: t('items.mortar.empty') } : {})}
              onClick={grind}
            >
              {t('items.mortar.grind')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setMortar([]);
                setResult(null);
              }}
            >
              {t('items.mortar.clear')}
            </Button>
          </div>
          {result && (
            <p className="mortar-result" data-tone={result.tone} role="status">
              {result.text}
            </p>
          )}
        </section>

        <section aria-labelledby="mortar-known">
          <h3 id="mortar-known">{t('items.mortar.known')}</h3>
          {known.length === 0 ? (
            <p className="items-empty">{t('items.mortar.known-none')}</p>
          ) : (
            <ul className="mortar-known">
              {known.map((r) => (
                <li key={r.id}>
                  <strong>{t(r.nameKey as LocaleKey)}</strong>
                  <span>{t('items.mortar.needs', { inputs: list(r.inputs) })}</span>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setResult(null);
                      setMortar(r.inputs.map((i) => ({ item: i.item, qty: i.qty })));
                    }}
                  >
                    {t('items.mortar.fill')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mortar-journal" aria-labelledby="mortar-journal">
        <h3 id="mortar-journal">
          <IconGlyph name="collection.recipes" size={20} tone="inherit" />{' '}
          {t('items.mortar.journal')}
        </h3>
        {attempts.length === 0 ? (
          <p className="items-empty">{t('items.mortar.journal-empty')}</p>
        ) : (
          <ol>
            {attempts.map((a, i) => (
              <li
                key={`${String(a.day)}-${String(a.minute)}-${String(i)}`}
                data-ok={a.recipe !== null || undefined}
              >
                <time>{formatTime(a.minute)}</time>{' '}
                {t('items.mortar.attempt', {
                  ingredients: list(a.ingredients),
                  result: resultOf(a),
                })}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
