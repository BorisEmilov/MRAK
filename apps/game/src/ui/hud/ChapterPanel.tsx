/**
 * The festival chapter at a glance (docs/lore/festivals.md): its name, what hunts during it, and
 * its rites — one choice each, once per chapter; a choice with a check rolls (with omen).
 */
import type { LocaleKey } from '@mrak/content';
import { Button, Tooltip } from '@mrak/ui-kit';
import { t } from '../../i18n/t';
import { useApp, useUi } from '../../state/hooks';

export function ChapterPanel() {
  const { host } = useApp();
  const snapshot = useUi((s) => s.snapshot);
  const chapter = snapshot?.calendar.chapterId ?? null;
  if (!snapshot || chapter === null) return null;
  const f = host.content.find('festivals', chapter);
  if (!f) return null;
  const rites = f.rites.filter(
    (r) =>
      !snapshot.village.rites.includes(`${f.id}/${r.id}`) &&
      snapshot.calendar.nightIndex >= r.fromNight - 1,
  );
  return (
    <aside className="chapter-panel" aria-label={t(f.nameKey as LocaleKey)}>
      <Tooltip
        title={t(f.nameKey as LocaleKey)}
        description={t(f.descKey as LocaleKey)}
        extra={f.threatKey ? t(f.threatKey as LocaleKey) : undefined}
      >
        <p className="chapter-name">
          {t('chapter.night', {
            chapter: t(f.nameKey as LocaleKey),
            night: snapshot.calendar.nightIndex,
            nights: f.nights,
          })}
        </p>
      </Tooltip>
      {rites.map((r) => (
        <div key={r.id} className="chapter-rite">
          <Tooltip title={t(r.nameKey as LocaleKey)} description={t(r.descKey as LocaleKey)}>
            <strong>{t(r.nameKey as LocaleKey)}</strong>
          </Tooltip>
          {r.options.map((o) => (
            <Button
              key={o.id}
              onClick={() => {
                host.dispatch({ type: 'performRite', rite: r.id, option: o.id });
              }}
            >
              {t(o.labelKey as LocaleKey)}
              {o.check
                ? ` · ${t('chapter.check', {
                    skill: t(`skill.${o.check.skill}.name` as LocaleKey),
                    difficulty: t(`check.difficulty.${o.check.difficulty}` as LocaleKey),
                  })}`
                : ''}
            </Button>
          ))}
        </div>
      ))}
    </aside>
  );
}
