/** Options (docs/ui/accessibility.md): audio, display & accessibility, gameplay, controls. */
import type { LocaleKey } from '@mrak/content';
import { Button, KeyHint, Tabs, TEXT_SCALES, type ColorblindMode } from '@mrak/ui-kit';
import { useState, type ReactNode } from 'react';
import {
  ACTIONS,
  rebind,
  resolveBindings,
  RESERVED_KEYS,
  type ActionId,
} from '../../input/bindings';
import { t } from '../../i18n/t';
import { toggleFullscreen } from '../../platform';
import { useApp, useUi } from '../../state/hooks';
import type { Options } from '../../storage/options';
import { updateOptions } from '../../storage/update-options';

type VolumeKey = 'masterVolume' | 'musicVolume' | 'sfxVolume';
type ToggleKey =
  | 'subtitles'
  | 'soundCaptions'
  | 'reduceFlashes'
  | 'reduceShake'
  | 'reduceDistortion'
  | 'fewerScares'
  | 'hints'
  | 'hudAutoFade'
  | 'pauseOnBlur';

const VOLUMES: [VolumeKey, LocaleKey][] = [
  ['masterVolume', 'options.master-volume'],
  ['musicVolume', 'options.music-volume'],
  ['sfxVolume', 'options.sfx-volume'],
];
const TOGGLES: Record<ToggleKey, [LocaleKey, LocaleKey]> = {
  subtitles: ['options.subtitles', 'options.subtitles-desc'],
  soundCaptions: ['options.sound-captions', 'options.sound-captions-desc'],
  reduceFlashes: ['options.reduce-flashes', 'options.reduce-flashes-desc'],
  reduceShake: ['options.reduce-shake', 'options.reduce-shake-desc'],
  reduceDistortion: ['options.reduce-distortion', 'options.reduce-distortion-desc'],
  fewerScares: ['options.fewer-scares', 'options.fewer-scares-desc'],
  hints: ['options.hints', 'options.hints-desc'],
  hudAutoFade: ['options.hud-auto-fade', 'options.hud-auto-fade-desc'],
  pauseOnBlur: ['options.pause-on-blur', 'options.pause-on-blur-desc'],
};
const COLORBLIND: ColorblindMode[] = [
  'none',
  'protanopia',
  'deuteranopia',
  'tritanopia',
  'monochrome',
];

function Toggle({
  k,
  options,
  onChange,
}: {
  k: ToggleKey;
  options: Options;
  onChange: (p: Partial<Options>) => void;
}) {
  const id = `opt-${k}`;
  return (
    <div className="field checkbox">
      <input
        id={id}
        type="checkbox"
        checked={options[k]}
        aria-describedby={`${id}-desc`}
        onChange={(e) => {
          onChange({ [k]: e.target.checked });
        }}
      />
      <label htmlFor={id}>
        {t(TOGGLES[k][0])}
        <span id={`${id}-desc`} className="field-desc">
          {t(TOGGLES[k][1])}
        </span>
      </label>
    </div>
  );
}

function Select<V extends string | number>({
  label,
  value,
  values,
  text,
  onChange,
}: {
  label: string;
  value: V;
  values: readonly V[];
  text: (v: V) => string;
  onChange: (v: V) => void;
}) {
  const id = `opt-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={String(value)}
        onChange={(e) => {
          const v = values.find((x) => String(x) === e.target.value);
          if (v !== undefined) onChange(v);
        }}
      >
        {values.map((v) => (
          <option key={String(v)} value={String(v)}>
            {text(v)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Controls({
  options,
  onChange,
}: {
  options: Options;
  onChange: (p: Partial<Options>) => void;
}) {
  const [listening, setListening] = useState<ActionId | null>(null);
  const bindings = resolveBindings(options.keyBindings);
  return (
    <>
      <p className="muted">{t('options.controls-help')}</p>
      <table className="bindings">
        <thead>
          <tr>
            <th scope="col">{t('options.action')}</th>
            <th scope="col">{t('options.key')}</th>
            <th scope="col">{t('options.gamepad')}</th>
          </tr>
        </thead>
        <tbody>
          {ACTIONS.map((a) => (
            <tr key={a.id}>
              <th scope="row" id={`bind-${a.id}`}>
                {t(a.labelKey)}
              </th>
              <td>
                <button
                  type="button"
                  className="mrak-button rebind"
                  id={`bind-${a.id}-key`}
                  // Name = action + visible key (WCAG 2.5.3: the visible label is part of the name).
                  aria-labelledby={`bind-${a.id} bind-${a.id}-key`}
                  title={t('options.rebind', { action: t(a.labelKey) })}
                  aria-pressed={listening === a.id}
                  onClick={() => {
                    setListening(a.id);
                  }}
                  onKeyDown={(e) => {
                    if (listening !== a.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.code === 'Escape' && a.id !== 'pause') {
                      setListening(null);
                      return;
                    }
                    if (!RESERVED_KEYS.has(e.code))
                      onChange({ keyBindings: rebind(options.keyBindings, a.id, e.code) });
                    setListening(null);
                  }}
                  onBlur={() => {
                    setListening(null);
                  }}
                >
                  {listening === a.id ? (
                    t('options.press-key')
                  ) : (
                    <KeyHint binding={{ keys: bindings[a.id].keys }} />
                  )}
                </button>
              </td>
              <td>
                {'pad' in a ? (
                  <KeyHint binding={{ keys: [], pad: a.pad }} />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        onClick={() => {
          onChange({ keyBindings: {} });
        }}
      >
        {t('options.reset-bindings')}
      </Button>
    </>
  );
}

export function OptionsPanel({ onBack }: { onBack: () => void }) {
  const { store, presentation } = useApp();
  const options = useUi((s) => s.options);
  const [tab, setTab] = useState('display');
  const update = (patch: Partial<Options>): void => {
    updateOptions(store, patch);
  };
  const section = (children: ReactNode) => <div className="form">{children}</div>;

  return (
    <>
      <h2>{t('menu.options')}</h2>
      <Tabs
        label={t('menu.options')}
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'display',
            label: t('options.tab-accessibility'),
            icon: 'ui.info',
            content: section(
              <>
                <Select
                  label={t('options.text-size')}
                  value={options.textScale}
                  values={TEXT_SCALES}
                  text={(v) => `${String(Math.round(v * 100))}%`}
                  onChange={(v) => {
                    update({ textScale: v });
                  }}
                />
                <Select
                  label={t('options.colorblind')}
                  value={options.colorblind}
                  values={COLORBLIND}
                  text={(v) => t(`options.colorblind-${v}`)}
                  onChange={(v) => {
                    update({ colorblind: v });
                  }}
                />
                <Select
                  label={t('options.reduce-motion')}
                  value={options.reduceMotion}
                  values={['system', 'on', 'off'] as const}
                  text={(v) => t(`options.reduce-motion-${v}`)}
                  onChange={(v) => {
                    update({ reduceMotion: v });
                  }}
                />
                <Toggle k="subtitles" options={options} onChange={update} />
                <Toggle k="soundCaptions" options={options} onChange={update} />
                <Toggle k="reduceFlashes" options={options} onChange={update} />
                <Toggle k="reduceShake" options={options} onChange={update} />
                <Toggle k="reduceDistortion" options={options} onChange={update} />
                <Toggle k="fewerScares" options={options} onChange={update} />
                <Button
                  onClick={() => {
                    void toggleFullscreen();
                  }}
                >
                  {t('options.fullscreen')}
                </Button>
              </>,
            ),
          },
          {
            id: 'audio',
            label: t('options.tab-audio'),
            icon: 'ui.caption',
            content: section(
              VOLUMES.map(([key, label]) => (
                <div key={key} className="field">
                  <label htmlFor={`opt-${key}`}>{t(label)}</label>
                  <input
                    id={`opt-${key}`}
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={options[key]}
                    aria-valuetext={`${String(Math.round(options[key] * 100))}%`}
                    onChange={(e) => {
                      update({ [key]: Number(e.target.value) });
                    }}
                  />
                </div>
              )),
            ),
          },
          {
            id: 'gameplay',
            label: t('options.tab-gameplay'),
            icon: 'ui.hint',
            content: section(
              <>
                <Toggle k="hints" options={options} onChange={update} />
                <Button onClick={presentation.resetHints}>{t('options.reset-hints')}</Button>
                <Toggle k="hudAutoFade" options={options} onChange={update} />
                <Toggle k="pauseOnBlur" options={options} onChange={update} />
              </>,
            ),
          },
          {
            id: 'controls',
            label: t('options.tab-controls'),
            icon: 'ui.keyboard',
            content: <Controls options={options} onChange={update} />,
          },
        ]}
      />
      <Button variant="primary" onClick={onBack}>
        {t('menu.back')}
      </Button>
    </>
  );
}
