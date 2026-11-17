/**
 * Talking to a villager (docs/systems/progression.md V1–V5): the guardian picks a tone. Tones
 * tagged with the guardian's virtue or sin are marked; with high Corruption the sin forbids some
 * (marked, with the reason) and may speak instead — the UI always says when it did (pillar 6).
 */
import type { LocaleKey } from '@mrak/content';
import { effectiveStat, progressionRules, takeoverChance } from '@mrak/core';
import { Button, IconGlyph, Modal } from '@mrak/ui-kit';
import { useEffect, useState } from 'react';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';
import { progressionReasonKey } from './progression-ui';

export function TalkDialog() {
  const { host, store } = useApp();
  const villager = useUi((s) => s.talking);
  const snapshot = useUi((s) => s.snapshot);
  const [said, setSaid] = useState<string | null>(null);
  const open = villager !== null;
  useEffect(() => {
    host.setPaused('talk', open);
    return () => {
      host.setPaused('talk', false);
    };
  }, [host, open]);
  if (!villager || !snapshot) return null;
  const db = host.content;
  const rules = progressionRules(db);
  const name = t((db.find('villagers', villager)?.nameKey ?? villager) as LocaleKey);
  const options = host.toneOptions();
  const sin = snapshot.guardian.sin ? db.find('sins', snapshot.guardian.sin) : undefined;
  const virtue = snapshot.guardian.virtue
    ? db.find('virtues', snapshot.guardian.virtue)
    : undefined;
  const risk = rules ? takeoverChance(snapshot, db, rules) : 0;
  const close = (): void => {
    setSaid(null);
    store.setState({ talking: null });
  };
  const speak = (tone: string): void => {
    const r = host.dispatch({ type: 'talkTo', villager, tone });
    if (!r.ok) {
      setSaid(
        t(r.reason === 'your sin will not allow it' ? 'talk.blocked' : 'notice.talk-refused', {
          name,
        }),
      );
      return;
    }
    const took = r.events.find((e) => e.type === 'sin/tookOver');
    if (took?.type === 'sin/tookOver') {
      const chosen = db.find('talk-tones', took.payload.chosen);
      setSaid(
        t('talk.sin-spoke', {
          sin: t((sin?.nameKey ?? '') as LocaleKey),
          words: chosen ? t(chosen.textKey as LocaleKey) : '',
        }),
      );
      return;
    }
    close();
  };

  return (
    <Modal open title={t('talk.title', { name })} size="md" variant="parchment" onClose={close}>
      <p className="items-hint">{t('talk.hint')}</p>
      {sin && risk > 0 && (
        <p className="talk-risk" role="note">
          <IconGlyph name="ui.sin" size={20} tone="inherit" />{' '}
          {t('talk.risk', {
            sin: t(sin.nameKey as LocaleKey),
            corruption: Math.round(effectiveStat(snapshot, db, 'corruption')),
          })}
        </p>
      )}
      <Button
        variant="secondary"
        icon="skill.exorcism"
        onClick={() => {
          const r = host.dispatch({ type: 'startExorcism', host: villager });
          if (r.ok) close();
        }}
      >
        {t('exorcism.start')}
      </Button>
      {said ? (
        <div className="talk-said" role="alert">
          <p>{said}</p>
          <Button variant="primary" onClick={close}>
            {t('talk.continue')}
          </Button>
        </div>
      ) : (
        <ul className="talk-tones">
          {options.map((o) => (
            <li key={o.tone.id} data-virtue={o.virtue || undefined} data-sin={o.sin || undefined}>
              <Button
                variant={o.sin ? 'danger' : o.virtue ? 'primary' : 'secondary'}
                {...(o.virtue
                  ? { icon: 'ui.virtue' as const }
                  : o.sin
                    ? { icon: 'ui.sin' as const }
                    : {})}
                {...(o.blockedBy
                  ? {
                      disabledReason: t('talk.blocked-by', {
                        sin: t((db.find('sins', o.blockedBy)?.nameKey ?? o.blockedBy) as LocaleKey),
                      }),
                    }
                  : {})}
                consequence={
                  o.virtue && virtue
                    ? t('talk.by-virtue', { virtue: t(virtue.nameKey as LocaleKey) })
                    : o.sin && sin
                      ? t('talk.by-sin', { sin: t(sin.nameKey as LocaleKey) })
                      : undefined
                }
                showConsequence={o.virtue || o.sin || o.blockedBy !== null}
                onClick={() => {
                  speak(o.tone.id);
                }}
              >
                {t(o.tone.textKey as LocaleKey)}
              </Button>
              {o.blockedBy && (
                <span className="talk-blocked">
                  <IconGlyph name="ui.locked" size={16} tone="inherit" />{' '}
                  {t(progressionReasonKey('your sin will not allow it'))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
