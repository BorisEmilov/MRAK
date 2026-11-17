/**
 * The deduction board (docs/systems/mysteries.md → Implementation): clue cards and propositions,
 * dragged freely and tied with red thread; zoom and pan; fully usable with the keyboard. It
 * never says whether a thread or an answer is right — only the final act will tell.
 */
import type { LocaleKey } from '@mrak/content';
import { propositionsOf } from '@mrak/core';
import { Button, IconGlyph, Modal, type IconName } from '@mrak/ui-kit';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import {
  CARD_H,
  CARD_W,
  clampZoom,
  defaultPosition,
  threadCount,
  type Point,
} from './board-layout';

const SOURCE_ICON: Record<string, IconName> = {
  zone: 'action.investigate',
  villager: 'action.talk',
  event: 'ui.warning',
  collectible: 'ui.journal',
};
const KIND_ICON: Record<string, IconName> = {
  culprit: 'action.accuse',
  cause: 'ui.search',
  remedy: 'action.ritual',
  motive: 'ui.clues',
  opportunity: 'ui.map',
};

interface Card {
  id: string;
  label: string;
  icon: IconName;
  clue: boolean;
  detail: string;
  retracted: boolean;
}

export function DeductionBoard() {
  const { host, store } = useApp();
  const mysteryId = useUi((s) => s.board);
  const snapshot = useUi((s) => s.snapshot);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ card: string | null; from: Point; origin: Point } | null>(
    null,
  );
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [answer, setAnswer] = useState({ culprit: '', cause: '', remedy: '' });
  const viewport = useRef<HTMLDivElement>(null);

  const state = mysteryId ? snapshot?.mysteries[mysteryId] : undefined;
  const mystery = mysteryId ? host.content.find('mysteries', mysteryId) : undefined;
  if (!mysteryId || !snapshot || !mystery || state?.status !== 'active') return null;
  const db = host.content;
  const tr = (k: string) => t(k as LocaleKey);
  const close = (): void => {
    setLinking(null);
    store.setState({ board: null });
  };
  const nameOf = (prop: string): string => {
    const [kind, id = ''] = prop.split(':');
    if (kind === 'cause') return tr(mystery.causes.find((c) => c.id === id)?.nameKey ?? id);
    if (kind === 'remedy') return tr(mystery.remedies.find((r) => r.id === id)?.nameKey ?? id);
    return tr(db.find('villagers', id)?.nameKey ?? id);
  };

  const clues = mystery.clues.filter((c) => state.clues.includes(c.id));
  const props = propositionsOf(mystery);
  const cards: Card[] = [
    ...clues.map((c) => ({
      id: c.id,
      label: tr(c.nameKey),
      icon: SOURCE_ICON[c.sources[0]?.kind ?? 'zone'] ?? 'ui.clues',
      clue: true,
      detail: `${tr(`board.source.${c.sources[0]?.kind ?? 'zone'}`)} · ${tr(`board.reliability.${c.reliability}`)}`,
      retracted: state.retracted.includes(c.id),
    })),
    ...props.map((p) => ({
      id: p,
      label: `${tr(`board.kind.${p.split(':')[0] ?? 'culprit'}`)} ${nameOf(p)}`,
      icon: KIND_ICON[p.split(':')[0] ?? ''] ?? 'ui.clues',
      clue: false,
      detail: t('board.support', { count: threadCount(state.links, p) }),
      retracted: false,
    })),
  ];
  const positions = new Map<string, Point>();
  let ci = 0;
  const perKind = new Map<string, number>();
  for (const c of cards) {
    const kind = c.clue ? '' : (c.id.split(':')[0] ?? '');
    const pi = perKind.get(kind) ?? 0;
    if (!c.clue) perKind.set(kind, pi + 1);
    const p = moved[c.id] ?? state.board[c.id] ?? defaultPosition(c.id, ci, pi);
    if (c.clue) ci++;
    positions.set(c.id, p);
  }

  const commitMove = (card: string, p: Point): void => {
    host.dispatch({ type: 'moveBoardCard', mystery: mysteryId, card, x: p.x, y: p.y });
  };
  const tie = (a: string, b: string): void => {
    const clue = cards.find((c) => c.clue && (c.id === a || c.id === b))?.id;
    const prop = [a, b].find((x) => x.includes(':'));
    setLinking(null);
    if (!clue || !prop) return;
    const has = state.links.some((l) => l.clue === clue && l.proposition === prop);
    host.dispatch({ type: 'linkClue', mystery: mysteryId, clue, proposition: prop, linked: !has });
  };
  const activate = (id: string): void => {
    if (linking === null) setLinking(id);
    else if (linking === id) setLinking(null);
    else tie(linking, id);
  };

  const onPointerDown = (e: PointerEvent, card: string | null): void => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const origin = card ? (positions.get(card) ?? { x: 0, y: 0 }) : pan;
    setDrag({ card, from: { x: e.clientX, y: e.clientY }, origin });
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!drag) return;
    const dx = e.clientX - drag.from.x;
    const dy = e.clientY - drag.from.y;
    if (drag.card)
      setMoved((m) => ({
        ...m,
        [drag.card as string]: { x: drag.origin.x + dx / zoom, y: drag.origin.y + dy / zoom },
      }));
    else setPan({ x: drag.origin.x + dx, y: drag.origin.y + dy });
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (!drag) return;
    const card = drag.card;
    const p = card ? moved[card] : undefined;
    const dist = Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y);
    setDrag(null);
    if (card && p && dist > 4) commitMove(card, p);
    else if (card) activate(card);
  };
  const onCardKey = (e: KeyboardEvent, id: string): void => {
    const step = e.shiftKey ? 60 : 20;
    const p = positions.get(id) ?? { x: 0, y: 0 };
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = delta[e.key];
    if (d) {
      e.preventDefault();
      const next = { x: p.x + d.x, y: p.y + d.y };
      setMoved((m) => ({ ...m, [id]: next }));
      commitMove(id, next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(id);
    } else if (e.key === 'Escape' && linking) {
      e.stopPropagation();
      setLinking(null);
    }
  };

  const remedy = mystery.remedies.find((r) => r.id === answer.remedy);
  const ready = answer.culprit !== '' && answer.cause !== '' && remedy !== undefined;
  const act = (): void => {
    if (!ready) return;
    const r = host.dispatch({ type: 'concludeMystery', mystery: mysteryId, ...answer });
    if (r.ok) close();
  };
  const center = (id: string): Point => {
    const p = positions.get(id) ?? { x: 0, y: 0 };
    return { x: p.x + CARD_W / 2, y: p.y + CARD_H / 2 };
  };

  return (
    <Modal
      open
      title={`${t('board.title')} — ${tr(mystery.nameKey)}`}
      size="xl"
      variant="parchment"
      onClose={close}
    >
      <p className="items-hint">{tr(mystery.questionKey)}</p>
      <p className="items-hint">{t('board.hint')}</p>
      <div className="board-toolbar" role="toolbar" aria-label={t('board.title')}>
        <Button
          variant="secondary"
          onClick={() => {
            setZoom((z) => clampZoom(z + 0.2));
          }}
        >
          {t('board.zoom-in')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setZoom((z) => clampZoom(z - 0.2));
          }}
        >
          {t('board.zoom-out')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          {t('board.reset')}
        </Button>
        {linking && (
          <span role="status">
            {t('board.linking', { card: cards.find((c) => c.id === linking)?.label ?? '' })}
          </span>
        )}
      </div>
      <div
        ref={viewport}
        className="board-viewport"
        onPointerDown={(e) => {
          onPointerDown(e, null);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => {
          setZoom((z) => clampZoom(z - Math.sign(e.deltaY) * 0.1));
        }}
      >
        <div
          className="board-layer"
          style={{
            transform: `translate(${String(pan.x)}px, ${String(pan.y)}px) scale(${String(zoom)})`,
          }}
        >
          <svg className="board-threads" width="2200" height="1400" aria-hidden="true">
            {state.links.map((l) => {
              const a = center(l.clue);
              const b = center(l.proposition);
              return (
                <line key={`${l.clue}|${l.proposition}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              );
            })}
          </svg>
          {cards.map((c) => {
            const p = positions.get(c.id) ?? { x: 0, y: 0 };
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                aria-pressed={linking === c.id}
                aria-label={`${c.label}. ${c.detail}${c.retracted ? `. ${t('board.retracted')}` : ''}`}
                className={`board-card${c.clue ? ' board-clue' : ' board-prop'}${c.retracted ? ' board-retracted' : ''}${linking === c.id ? ' board-linking' : ''}`}
                style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
                onPointerDown={(e) => {
                  onPointerDown(e, c.id);
                }}
                onPointerUp={onPointerUp}
                onKeyDown={(e) => {
                  onCardKey(e, c.id);
                }}
              >
                <IconGlyph name={c.icon} size={20} tone="inherit" />
                <span className="board-card-label">{c.label}</span>
                <small>{c.retracted ? t('board.retracted') : c.detail}</small>
              </div>
            );
          })}
        </div>
      </div>
      <form
        className="board-answer"
        onSubmit={(e) => {
          e.preventDefault();
          act();
        }}
      >
        <label>
          {t('board.culprit')}
          <select
            value={answer.culprit}
            onChange={(e) => {
              setAnswer({ ...answer, culprit: e.target.value });
            }}
          >
            <option value="">{t('board.choose')}</option>
            {mystery.suspects.map((s) => (
              <option key={s.villager} value={s.villager}>
                {nameOf(`culprit:${s.villager}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('board.cause')}
          <select
            value={answer.cause}
            onChange={(e) => {
              setAnswer({ ...answer, cause: e.target.value });
            }}
          >
            <option value="">{t('board.choose')}</option>
            {mystery.causes.map((c) => (
              <option key={c.id} value={c.id}>
                {tr(c.nameKey)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('board.remedy')}
          <select
            value={answer.remedy}
            onChange={(e) => {
              setAnswer({ ...answer, remedy: e.target.value });
            }}
          >
            <option value="">{t('board.choose')}</option>
            {mystery.remedies.map((r) => (
              <option key={r.id} value={r.id}>
                {tr(r.nameKey)}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          variant="danger"
          irreversible
          consequence={t('board.act-warning')}
          {...(ready ? {} : { disabledReason: t('board.choose') })}
        >
          {tr(`board.action.${remedy?.action ?? 'accuse'}`)}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            host.dispatch({ type: 'abandonMystery', mystery: mysteryId });
            close();
          }}
        >
          {t('board.abandon')}
        </Button>
      </form>
    </Modal>
  );
}
