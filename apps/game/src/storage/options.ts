/** Player options. Stored in localStorage: a per-device convenience, never game progress or tokens. */
import { COLORBLIND_MODES, TEXT_SCALES } from '@mrak/ui-kit';
import { z } from 'zod';
import { ACTIONS } from '../input/bindings';

const ACTION_IDS = ACTIONS.map((a) => a.id) as [string, ...string[]];

export const OptionsSchema = z.object({
  masterVolume: z.number().min(0).max(1).default(0.8),
  musicVolume: z.number().min(0).max(1).default(0.7),
  sfxVolume: z.number().min(0).max(1).default(0.9),
  /** Scales all UI text (pillar 6: readable fonts). */
  textScale: z
    .number()
    .refine((v) => (TEXT_SCALES as readonly number[]).includes(v))
    .default(1),
  /** No screen distortion at low sanity. */
  reduceDistortion: z.boolean().default(false),
  /** Camera flashes become slow fades. */
  reduceFlashes: z.boolean().default(false),
  /** No screen shake. */
  reduceShake: z.boolean().default(false),
  /** UI animations: follow the system setting, or force on/off. */
  reduceMotion: z.enum(['system', 'on', 'off']).default('system'),
  colorblind: z
    .enum(
      Object.keys(COLORBLIND_MODES) as [
        keyof typeof COLORBLIND_MODES,
        ...(keyof typeof COLORBLIND_MODES)[],
      ],
    )
    .default('none'),
  subtitles: z.boolean().default(true),
  soundCaptions: z.boolean().default(true),
  /** No jump-scare stingers or sudden full-screen apparitions. */
  fewerScares: z.boolean().default(false),
  hints: z.boolean().default(true),
  /** Hint ids already shown (onboarding progress is per device, not game state). */
  seenHints: z.array(z.string().max(64)).max(500).default([]),
  hudAutoFade: z.boolean().default(true),
  /** Pause when the tab loses focus. */
  pauseOnBlur: z.boolean().default(true),
  keyBindings: z
    .partialRecord(z.enum(ACTION_IDS), z.array(z.string().max(32)).min(1).max(2))
    .default({}),
});
export type Options = z.infer<typeof OptionsSchema>;

const KEY = 'mrak.options.v1';

export const DEFAULT_OPTIONS: Options = OptionsSchema.parse({});

export function loadOptions(storage: Pick<Storage, 'getItem'> | undefined): Options {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_OPTIONS;
    const parsed = OptionsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_OPTIONS;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

export function saveOptions(storage: Pick<Storage, 'setItem'> | undefined, options: Options): void {
  try {
    storage?.setItem(KEY, JSON.stringify(options));
  } catch {
    // Private mode or blocked storage: options simply do not persist.
  }
}
