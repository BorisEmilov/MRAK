/** Subtitles and sound captions (docs/ui/accessibility.md), fed by `audio:caption` on the UI bus. */
import type { LocaleKey } from '@mrak/content';
import { IconGlyph } from '@mrak/ui-kit';
import { useEffect, useState } from 'react';
import type { Caption } from '../events/EventBus';
import { t } from '../i18n/t';
import { useApp, useUi } from '../state/hooks';

export const CAPTION_DEFAULT_MS = 3500;
const MAX_LINES = 3;

interface Line extends Caption {
  id: number;
}

let nextId = 1;

export function Captions() {
  const { bus } = useApp();
  const subtitles = useUi((s) => s.options.subtitles);
  const soundCaptions = useUi((s) => s.options.soundCaptions);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(
    () =>
      bus.on('audio:caption', (caption) => {
        if (caption.kind === 'speech' ? !subtitles : !soundCaptions) return;
        const line = { ...caption, id: nextId++ };
        setLines((list) => [...list, line].slice(-MAX_LINES));
        window.setTimeout(() => {
          setLines((list) => list.filter((l) => l.id !== line.id));
        }, caption.durationMs ?? CAPTION_DEFAULT_MS);
      }),
    [bus, subtitles, soundCaptions],
  );

  if (lines.length === 0) return null;
  return (
    <div className="captions" aria-live="polite">
      {lines.map((l) => (
        <p key={l.id} className="caption" data-kind={l.kind}>
          {l.kind === 'sound' ? (
            <>
              <IconGlyph name="ui.caption" size={16} tone="muted" />
              {l.direction === 'left' && <span aria-hidden="true">← </span>}[
              {t(l.textKey as LocaleKey)}]
              {l.direction === 'right' && <span aria-hidden="true"> →</span>}
              {l.direction && l.direction !== 'center' && (
                <span className="mrak-sr-only"> {t(`caption.direction-${l.direction}`)}</span>
              )}
            </>
          ) : (
            <>
              {l.speakerKey && <strong>{t(l.speakerKey as LocaleKey)}: </strong>}
              {t(l.textKey as LocaleKey)}
            </>
          )}
        </p>
      ))}
    </div>
  );
}
