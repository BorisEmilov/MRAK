/** Onboarding content (docs/systems/onboarding.md): tutorial/contextual hints and the glossary. */
import { z } from 'zod';
import { Condition } from '../lang';
import { LocKey, Origin, entityBase, ref } from '../primitives';

export const GlossaryEntry = z
  .strictObject({
    ...entityBase,
    /** Transliterated term ("karakondzhul") or game term ("Revelation"). */
    termKey: LocKey,
    /** English explanation. */
    descKey: LocKey,
    category: z.enum(['folklore', 'history', 'game']),
    origin: Origin,
  })
  .meta({ id: 'GlossaryEntry' });

/** What makes a hint eligible; the game maps core events and UI signals to these. */
export const HINT_TRIGGERS = [
  'game-started',
  'zone-entered',
  'night-started',
  'dawn',
  'decision-recorded',
  'item-added',
  'stat-changed',
  'interaction-available',
  'low-sanity',
] as const;

export const Hint = z
  .strictObject({
    ...entityBase,
    titleKey: LocKey,
    textKey: LocKey,
    /** Icon name from the ui-kit set (`resource.light`); checked by the game tests. */
    icon: z
      .string()
      .regex(/^[a-z][a-z-]*\.[a-z0-9][a-z0-9-]*$/)
      .optional(),
    phase: z.enum(['prologue', 'first-night', 'contextual']),
    on: z.enum(HINT_TRIGGERS),
    when: Condition.optional(),
    /** Higher shows first when several are queued. */
    priority: z.int().min(0).max(100).default(50),
    /** Glossary terms the hint links to. */
    glossary: z.array(ref('glossary-term')).default([]),
  })
  .meta({ id: 'Hint' });

export type GlossaryEntry = z.infer<typeof GlossaryEntry>;
export type Hint = z.infer<typeof Hint>;
export type HintTrigger = (typeof HINT_TRIGGERS)[number];
