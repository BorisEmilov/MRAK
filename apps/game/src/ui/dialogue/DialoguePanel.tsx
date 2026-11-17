/**
 * Dialogue (docs/systems/dialogue.md → Implementation): portrait, name, text revealed letter by
 * letter (skippable; at once with reduced motion), choices with an icon for their nature,
 * disabled choices showing their requirement, the conversation's history, and Ink tag effects
 * (#shake, #whisper, #sfx). The game waits while it is open.
 */
import type { LocaleKey } from '@mrak/content';
import { Button, IconGlyph, Modal, Portrait, type IconName } from '@mrak/ui-kit';
import { useEffect, useState } from 'react';
import { DialogueRunner, type DialogueChoice, type DialogueLine } from '../../dialogue/runner';
import { STORIES } from '../../dialogue/stories';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { portraitUrl } from '../village/portrait';
import { requirementText } from './dialogue-ui';

const CHARS_PER_TICK = 2;
const TICK_MS = 18;

interface Said {
  who: string;
  text: string;
  whisper: boolean;
}

function reducedMotion(): boolean {
  const flag = document.documentElement.dataset['mrakReduceMotion'];
  if (flag !== undefined) return flag === 'true';
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** One line, revealed letter by letter; a click shows it all, the next click continues. */
function RevealLine({ line, onDone }: { line: DialogueLine; onDone: () => void }) {
  const { bus } = useApp();
  const full = line.text.length;
  const [shown, setShown] = useState(() => (reducedMotion() ? full : 0));
  useEffect(() => {
    if (line.sfx) bus.emit('audio:caption', { kind: 'sound', textKey: `sfx.${line.sfx}` });
  }, [line, bus]);
  useEffect(() => {
    if (shown >= full) return;
    const timer = window.setInterval(() => {
      setShown((n) => Math.min(full, n + CHARS_PER_TICK));
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [shown, full]);
  const revealing = shown < full;
  return (
    <button
      type="button"
      className="dialogue-line"
      data-whisper={line.whisper || undefined}
      aria-label={revealing ? t('dialogue.skip') : t('dialogue.continue')}
      onClick={() => {
        if (revealing) setShown(full);
        else onDone();
      }}
    >
      <span aria-live="polite">{line.text.slice(0, shown)}</span>
      <span className="dialogue-hint">
        {revealing ? t('dialogue.skip') : t('dialogue.continue')}
      </span>
    </button>
  );
}

function Conversation({
  runner,
  villager,
  onClose,
}: {
  runner: DialogueRunner;
  villager: string | null;
  onClose: () => void;
}) {
  const { host } = useApp();
  const [step, setStep] = useState(() => runner.next());
  const [lineIndex, setLineIndex] = useState(0);
  const [history, setHistory] = useState<Said[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const db = host.content;
  const who = villager ? db.find('villagers', villager) : undefined;
  const speakerName = (id: string | null): string => {
    if (id === 'guardian') return t('dialogue.you');
    const v = id ? db.find('villagers', id) : who;
    return v ? t(v.nameKey as LocaleKey) : t(`dialogue.speaker.${runner.storyId}` as LocaleKey);
  };
  const line = step.lines[lineIndex];
  const done = (l: DialogueLine): void => {
    setHistory((h) => [...h, { who: speakerName(l.speaker), text: l.text, whisper: l.whisper }]);
    setLineIndex((i) => i + 1);
  };
  const choose = (c: DialogueChoice): void => {
    const result = runner.choose(c.index);
    if (!result) {
      setNote(t('dialogue.refused'));
      return;
    }
    const taken = step.choices.find((x) => x.index === result.chosen);
    setHistory((h) => [
      ...h,
      { who: t('dialogue.you'), text: taken?.text ?? c.text, whisper: false },
    ]);
    const sin = db.find('sins', host.snapshot()?.guardian.sin ?? '');
    setNote(
      result.sinSpoke
        ? t('dialogue.sin-spoke', { sin: sin ? t(sin.nameKey as LocaleKey) : '' })
        : null,
    );
    setStep(runner.next());
    setLineIndex(0);
  };
  const portrait = who ? portraitUrl(who.id, who.look, 'living') : null;

  return (
    <Modal
      open
      title={speakerName(line?.speaker ?? null)}
      size="lg"
      variant="parchment"
      onClose={onClose}
    >
      <div className="dialogue" data-shake={line?.shake || undefined}>
        <div className="dialogue-head">
          <Portrait
            name={speakerName(null)}
            {...(portrait ? { src: portrait } : {})}
            size="md"
            showName={false}
          />
          <Button
            variant="ghost"
            icon="ui.history"
            aria-pressed={showHistory}
            onClick={() => {
              setShowHistory((v) => !v);
            }}
          >
            {t('dialogue.history')}
          </Button>
        </div>

        {showHistory && (
          <ol className="dialogue-history" aria-label={t('dialogue.history')}>
            {history.map((h, i) => (
              <li key={i} data-whisper={h.whisper || undefined}>
                <strong>{h.who}:</strong> {h.text}
              </li>
            ))}
          </ol>
        )}

        {line ? (
          <RevealLine
            key={`${String(history.length)}-${line.text}`}
            line={line}
            onDone={() => {
              done(line);
            }}
          />
        ) : (
          <>
            {note && (
              <p className="dialogue-note" role="status">
                <IconGlyph name="ui.sin" size={20} tone="inherit" /> {note}
              </p>
            )}
            {step.ended ? (
              <Button variant="primary" onClick={onClose}>
                {t('dialogue.end')}
              </Button>
            ) : (
              <ul className="dialogue-choices" aria-label={t('dialogue.choices')}>
                {step.choices.map((c) => {
                  const sinName = c.blockedBy ? db.find('sins', c.blockedBy)?.nameKey : undefined;
                  const reason = c.requirement
                    ? requirementText(c.requirement, db, t)
                    : c.blockedBy
                      ? t('talk.blocked-by', {
                          sin: sinName ? t(sinName as LocaleKey) : c.blockedBy,
                        })
                      : null;
                  return (
                    <li key={c.index} data-sin={c.sin || undefined}>
                      <Button
                        variant={c.sin ? 'danger' : 'secondary'}
                        {...(c.nature ? { icon: `choice.${c.nature}` as IconName } : {})}
                        {...(reason ? { disabledReason: reason } : {})}
                        {...(c.nature
                          ? { consequence: t(`dialogue.nature.${c.nature}` as LocaleKey) }
                          : {})}
                        onClick={() => {
                          choose(c);
                        }}
                      >
                        {c.text}
                      </Button>
                      {reason && (
                        <span className="dialogue-requirement">
                          <IconGlyph name="ui.locked" size={16} tone="inherit" /> {reason}
                        </span>
                      )}
                      {c.virtue && <span className="dialogue-tag">{t('dialogue.by-virtue')}</span>}
                      {c.sin && <span className="dialogue-tag">{t('dialogue.by-sin')}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export function DialoguePanel() {
  const { host, store } = useApp();
  const open = useUi((s) => s.dialogue);
  // One runner per opened conversation (the open object changes each time one opens).
  const [current, setCurrent] = useState<{ key: object; runner: DialogueRunner } | null>(null);
  const json = open ? STORIES[open.story] : undefined;
  let runner = current?.key === open ? current.runner : null;
  if (open && json && !runner) {
    runner = new DialogueRunner(host, open.story, json);
    setCurrent({ key: open, runner });
  }
  useEffect(() => {
    host.setPaused('dialogue', open !== null);
    return () => {
      host.setPaused('dialogue', false);
    };
  }, [host, open]);
  if (!open || !runner) return null;
  return (
    <Conversation
      key={runner.serial}
      runner={runner}
      villager={open.villager}
      onClose={() => {
        store.setState({ dialogue: null });
      }}
    />
  );
}
