/**
 * The rite in progress (docs/systems/exorcism.md → Implementation): phase icons, the ritual
 * resources laid out, the demon's taunts, the naming and the expulsion meter.
 */
import type { LocaleKey } from '@mrak/content';
import type { IconName } from '@mrak/ui-kit';
import { fearRules, itemCount, trueNameProgress } from '@mrak/core';
import { Button, IconGlyph, Modal, ProgressMeter } from '@mrak/ui-kit';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

const PHASES = [
  ['preparation', 'item.salt'],
  ['confrontation', 'ui.demons'],
  ['naming', 'tree.exorcist'],
  ['expulsion', 'skill.exorcism'],
] as const;

export function ExorcismPanel() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const rite = snapshot?.exorcism;
  if (!snapshot || !rite) return null;
  const db = host.content;
  const rules = fearRules(db);
  if (!rules) return null;
  const tr = (key: string) => t(key as LocaleKey);
  const hostName = tr(db.find('villagers', rite.host)?.nameKey ?? rite.host);
  const run = (command: Parameters<typeof host.dispatch>[0]): void => {
    host.dispatch(command);
  };
  const phaseIndex = PHASES.findIndex(([p]) => p === rite.phase);
  const prep = rules.exorcism.preparation;
  const ritual = [
    ...db
      .all('items')
      .filter((i) => i.tags.includes(prep.holyTag))
      .map((i) => i.id),
    prep.circleItem,
    ...db.all('demons').flatMap((d) => d.weaknesses.flatMap((w) => (w.item ? [w.item] : []))),
  ].filter((id, i, a) => a.indexOf(id) === i && itemCount(snapshot, id, 'pack') > 0);
  const known = db.all('demons').filter((d) => trueNameProgress(snapshot, db, d.id).known);
  const x = rules.exorcism.expulsion;

  return (
    <Modal
      open
      dismissible={false}
      title={t('exorcism.title')}
      size="lg"
      variant="parchment"
      onClose={() => undefined}
    >
      <ol className="exorcism-phases" aria-label={t('exorcism.title')}>
        {PHASES.map(([phase, icon], i) => (
          <li
            key={phase}
            aria-current={i === phaseIndex ? 'step' : undefined}
            data-done={i < phaseIndex || undefined}
          >
            <IconGlyph
              name={icon as IconName}
              size={24}
              tone={i === phaseIndex ? 'inherit' : 'muted'}
            />
            {tr(`exorcism.phase.${phase}`)}
          </li>
        ))}
      </ol>
      <p className="items-hint">{hostName}</p>
      {rite.prepared.length > 0 && (
        <ul className="exorcism-altar">
          {rite.prepared.map((id) => (
            <li key={id}>
              <IconGlyph name={`item.${id}` as IconName} size={24} tone="inherit" />
              {tr(db.get('items', id).nameKey)}
            </li>
          ))}
        </ul>
      )}
      {rite.taunts.length > 0 && (
        <blockquote className="exorcism-taunts">
          {rite.taunts.map((taunt, i) => (
            <p key={String(i)}>
              {t(
                taunt.key as LocaleKey,
                Object.fromEntries(Object.entries(taunt.params).map(([k, v]) => [k, tr(v)])),
              )}
            </p>
          ))}
        </blockquote>
      )}
      <div className="exorcism-actions">
        {rite.phase === 'preparation' && (
          <>
            {rite.prepared.length < prep.maxItems &&
              ritual
                .filter((id) => !rite.prepared.includes(id))
                .map((id) => (
                  <Button
                    key={id}
                    variant="secondary"
                    icon={`item.${id}` as IconName}
                    onClick={() => {
                      run({ type: 'prepareExorcism', item: id });
                    }}
                  >
                    {t('exorcism.prepare', { item: tr(db.get('items', id).nameKey) })}
                  </Button>
                ))}
            <Button
              variant="primary"
              icon="ui.demons"
              onClick={() => {
                run({ type: 'confrontDemon' });
              }}
            >
              {t('exorcism.confront')}
            </Button>
          </>
        )}
        {rite.phase === 'naming' &&
          (known.length === 0 ? (
            <p>{t('exorcism.no-name')}</p>
          ) : (
            known.map((d) => (
              <span key={d.id}>
                <Button
                  variant="primary"
                  onClick={() => {
                    run({ type: 'speakName', demon: d.id, bind: false });
                  }}
                >
                  {t('exorcism.name', { name: tr(d.trueNameKey) })}
                </Button>
                <Button
                  variant="danger"
                  irreversible
                  onClick={() => {
                    run({ type: 'speakName', demon: d.id, bind: true });
                  }}
                >
                  {t('exorcism.bind', { name: tr(d.trueNameKey) })}
                </Button>
              </span>
            ))
          ))}
        {rite.phase === 'expulsion' && (
          <>
            <ProgressMeter
              label={t('exorcism.progress')}
              value={rite.progress}
              max={x.goal}
              icon="skill.exorcism"
              tone="faith"
              valueText={t('exorcism.round', { round: rite.round, rounds: x.rounds })}
            />
            <Button
              variant="primary"
              icon="resource.sanity"
              onClick={() => {
                run({ type: 'expel', effort: 'press' });
              }}
            >
              {t('exorcism.press')}
            </Button>
            <Button
              variant="secondary"
              icon="resource.sanity"
              onClick={() => {
                run({ type: 'expel', effort: 'hold' });
              }}
            >
              {t('exorcism.hold')}
            </Button>
          </>
        )}
        <Button
          variant="danger"
          onClick={() => {
            run({ type: 'abandonExorcism' });
          }}
        >
          {t('exorcism.abandon')}
        </Button>
      </div>
    </Modal>
  );
}
