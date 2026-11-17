/**
 * WorldState: the single, serializable source of truth of a playthrough
 * (docs/systems/world-state.md). The Zod schema is the source of the types; save files are
 * validated against it after migration.
 */
import { Effect, Modifier, Mystery, UsePeriod, Villager } from '@mrak/content-schema';
import { z } from 'zod';
import type { ContentDatabase } from '../content/database';
import { julianToJdn, type CalendarDate } from '../time/calendar';

const Id = z.string().min(1);
export const GameTimeSchema = z.strictObject({ day: z.int(), minute: z.int().min(0).max(1439) });

export const ClockStateSchema = z.strictObject({
  day: z.int(),
  minute: z.int().min(0).max(1439),
  subMinute: z.number().min(0).lt(1),
  speed: z.number().positive().max(100),
  paused: z.boolean(),
});

export const VillagerStatus = z.enum(['healthy', 'sick', 'terrified', 'dead', 'returned']);
export type VillagerStatus = z.infer<typeof VillagerStatus>;

const Slots = <T extends z.ZodType>(t: T) => z.strictObject({ day: t, night: t });

export const VillagerStateSchema = z.strictObject({
  alive: z.boolean(),
  /** Affinity toward other villagers and "guardian" (negative = grudge). */
  affinity: z.record(Id, z.number().min(-100).max(100)),
  /** Visible status; a hidden possession is never a status (see `possessions`). */
  status: VillagerStatus,
  /** Assigned task per slot. */
  tasks: Slots(Id.nullable()),
  /** Effective minutes worked toward the next batch, per slot. */
  progress: Slots(z.number().min(0)),
  /** Finished day batches waiting to be delivered at dusk, by task. */
  pending: z.record(Id, z.int().min(1).max(100)),
  /** The current batch waits for materials (reported once). */
  stalled: z.boolean(),
  /** A panic was reported (cleared when fear drops below the terrified threshold). */
  panicked: z.boolean(),
  /** Revealed secret ids. */
  secrets: z.array(Id),
  death: z
    .strictObject({
      day: z.int(),
      minute: z.int().min(0).max(1439),
      cause: Id,
      burial: z.enum(['pending', 'proper', 'improper']),
      /** Nights the villager has walked as one of the returned. */
      nightsReturned: z.int().min(0),
    })
    .nullable(),
});
export type VillagerState = z.infer<typeof VillagerStateSchema>;

/** A living villager's state as content defines it at the start. */
export function newVillagerState(affinity: Record<string, number>): VillagerState {
  return {
    alive: true,
    affinity,
    status: 'healthy',
    tasks: { day: null, night: null },
    progress: { day: 0, night: 0 },
    pending: {},
    stalled: false,
    panicked: false,
    secrets: [],
    death: null,
  };
}

/** A stack of items (docs/systems/inventory.md); `potency` absent = the item's default. */
export const StackSchema = z.strictObject({
  item: Id,
  qty: z.int().min(1).max(100_000),
  potency: z.int().min(1).max(3).optional(),
});
export type Stack = z.infer<typeof StackSchema>;

const Moment = z.strictObject({ day: z.int(), minute: z.int().min(0).max(1439) });

export const PhotoSubjectSchema = z.union([
  z.strictObject({ villager: Id }),
  z.strictObject({ zone: Id, poi: Id }),
  z.strictObject({ zone: Id }),
]);
export type PhotoSubject = z.infer<typeof PhotoSubjectSchema>;
export type ReadonlyPhotoSubject = Readonly<PhotoSubject>;

export const PhotoSchema = z.strictObject({
  id: z.int().min(1),
  day: z.int(),
  minute: z.int().min(0).max(1439),
  /** Zone the photo was taken in. */
  zone: Id,
  subject: PhotoSubjectSchema,
  /** Photo layers on the plate. */
  layers: z.array(Id).max(32),
});
export type Photo = z.infer<typeof PhotoSchema>;

export const AlchemyHint = z.enum(['excess', 'missing', 'kindred', 'nothing']);
export type AlchemyHint = z.infer<typeof AlchemyHint>;

export const AttemptSchema = z.strictObject({
  ...Moment.shape,
  ingredients: z
    .array(z.strictObject({ item: Id, qty: z.int().min(1).max(99) }))
    .min(1)
    .max(8),
  /** Recipe brewed, or null for a failed experiment. */
  recipe: Id.nullable(),
  hint: AlchemyHint.nullable(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

const SkillStateSchema = z.strictObject({
  rank: z.int().min(0).max(5),
  cap: z.int().min(0).max(5),
  practice: z.int().min(0).max(10_000),
});
export type SkillState = z.infer<typeof SkillStateSchema>;

export const LedgerEntrySchema = z.strictObject({
  milestone: Id,
  amount: z.int(),
  target: z.string().optional(),
  day: z.int(),
  minute: z.int().min(0).max(1439),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const BlessingStateSchema = z.strictObject({
  blessing: Id,
  usesLeft: z.int().min(0).nullable(),
  nightsLeft: z.int().min(0).nullable(),
});
export type BlessingState = z.infer<typeof BlessingStateSchema>;

/** Equipment slots besides the lantern (docs/systems/progression.md G1). */
export const EQUIP_SLOTS = ['weapon', 'amulet', 'amulet-2', 'tool', 'clothing'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Guardian progression (docs/systems/progression.md §1). */
export const ProgressionStateSchema = z.strictObject({
  attributes: z.record(Id, z.int().min(1).max(6)),
  skills: z.record(Id, SkillStateSchema),
  /** "skill:target" → absolute minute of the last practice (anti-grind). */
  practiceLog: z.record(z.string(), z.int()),
  practiceToday: z.strictObject({ day: z.int(), points: z.record(Id, z.int().min(0)) }),
  revelation: z.strictObject({
    lifetime: z.number().min(0),
    ledger: z.array(LedgerEntrySchema).max(2000),
  }),
  /** Granted milestone keys ("id" or "id:target"). */
  milestones: z.array(z.string()).max(5000),
  virtue: Id.nullable(),
  sin: Id.nullable(),
  /** Acts by the virtue in the current chapter. */
  virtueActs: z.int().min(0),
  /** Last day the virtue boon was earned, and whether it is still unused. */
  boonDay: z.int().nullable(),
  boonReady: z.boolean(),
  equipment: z.partialRecord(z.enum(EQUIP_SLOTS), Id),
  gear: z.array(Id).max(64),
  blessings: z.record(Id, z.array(BlessingStateSchema).max(6)),
  upgrades: z.record(Id, z.array(Id).max(8)),
});
export type ProgressionState = z.infer<typeof ProgressionStateSchema>;

export function emptyProgression(): ProgressionState {
  return {
    attributes: {},
    skills: {},
    practiceLog: {},
    practiceToday: { day: 0, points: {} },
    revelation: { lifetime: 0, ledger: [] },
    milestones: [],
    virtue: null,
    sin: null,
    virtueActs: 0,
    boonDay: null,
    boonReady: false,
    equipment: {},
    gear: [],
    blessings: {},
    upgrades: {},
  };
}

export const DebtHistorySchema = z.strictObject({
  day: z.int(),
  collection: Id,
  source: Id,
  severity: z.enum(['minor', 'major', 'grave']),
});

export const JournalStateSchema = z.strictObject({
  /** "demon:<id>" / "creature:<id>" entries. */
  learned: z.array(z.string()).max(500),
  notes: z
    .array(
      z.strictObject({
        id: z.int().min(1),
        text: z.string().min(1).max(2000),
        day: z.int(),
        minute: z.int().min(0).max(1439),
      }),
    )
    .max(500),
  nextNote: z.int().min(1),
  /** Entry keys ("clue:x", "demon:y", "note:3"…) marked to pass to the heir. */
  heir: z.array(z.string()).max(500),
});

export function emptyJournal(): z.infer<typeof JournalStateSchema> {
  return { learned: [], notes: [], nextNote: 1, heir: [] };
}

/** Fear engine state (docs/systems/event-director.md, hysteria.md, sanity.md → Implementation). */
/** A resident the years brought: born in Mrak, a newcomer, or a guardian of the house. */
export const PersonSchema = z.strictObject({
  id: z.string().regex(/^p-\d+$/),
  nameKey: z.string().min(1).max(120),
  sex: z.enum(['female', 'male']),
  /** Julian year of birth. */
  born: z.int(),
  origin: z.enum(['born', 'outsider', 'guardian']),
  /** Place in the guardian's house (`villager`: not of the house). */
  role: z.enum(['villager', 'guardian', 'spouse', 'child', 'apprentice', 'elder']),
  tradeKey: z.string().max(120).nullable(),
  secret: Id.nullable(),
  /** Person or villager ids. */
  parents: z.array(z.string()).max(2),
  alive: z.boolean(),
  left: z.boolean(),
  died: z.int().nullable(),
  /** Portrait seed. */
  look: z.int().min(0),
  /** Guardians: their calling. */
  calling: Id.nullable(),
});
export type Person = z.infer<typeof PersonSchema>;

/** Village growth slices (docs/systems/village-growth.md → Implementation). */
export const GrowthStateShape = {
  /** Built level per building. */
  buildings: z.record(Id, z.int().min(1).max(5)),
  /** Work in progress: labour days done of those needed. */
  projects: z
    .array(
      z.strictObject({
        building: Id,
        level: z.int().min(1).max(5),
        labour: z.number().min(0),
        needed: z.int().min(0),
      }),
    )
    .max(20),
  people: z.array(PersonSchema).max(2000),
  nextPerson: z.int().min(1),
  /** Married couples, both directions (person or villager ids). */
  partners: z.record(z.string(), z.string()),
  /** Last Julian year turned (null until the first new year). */
  year: z.int().nullable(),
  /** Highest prosperity level ever reached (its unlocks applied). */
  bestLevel: z.int().min(1).max(5),
  /** Rites performed in the running chapter ("festival/rite"). */
  rites: z.array(z.string()).max(50),
  /** One line per year turned. */
  log: z
    .array(
      z.strictObject({
        year: z.int(),
        population: z.int().min(0),
        prosperity: z.number(),
        births: z.int().min(0),
        deaths: z.int().min(0),
        arrivals: z.int().min(0),
        departures: z.int().min(0),
      }),
    )
    .max(500),
};

export function emptyGrowth() {
  return {
    buildings: {},
    projects: [],
    people: [],
    nextPerson: 1,
    partners: {},
    year: null,
    bestLevel: 1,
    rites: [],
    log: [],
  };
}

/** The guardians' line (docs/systems/lineage.md → Implementation). */
export const LineageStateSchema = z.strictObject({
  deaths: z.array(z.strictObject({ day: z.int(), cause: Id })).max(100),
  awaitingHeir: z.boolean(),
  /** The serving guardian (a person), and the day their generation began. */
  guardian: z.string().nullable(),
  since: z.int().nullable(),
  /** Deeds of the serving generation (they earn Legacy). */
  deeds: z.strictObject({
    chapters: z.int().min(0),
    mysteries: z.int().min(0),
    buildings: z.int().min(0),
    routes: z.int().min(0),
  }),
  past: z
    .array(
      z.strictObject({
        person: z.string(),
        calling: Id.nullable(),
        from: z.int(),
        to: z.int(),
        cause: z.enum(['died', 'retired', 'old-age']),
        legacy: z.int().min(0),
      }),
    )
    .max(100),
  /** Bloodline nodes applied to the serving guardian (mirrors the account profile). */
  bloodline: z.array(Id).max(64),
  /** The world when the generation began, and the last generation jump's changes. */
  baseline: z.record(z.string(), z.number()).nullable(),
  summary: z
    .strictObject({
      from: z.int(),
      to: z.int(),
      predecessor: z.string(),
      heir: z.string(),
      cause: z.enum(['died', 'retired', 'old-age']),
      legacy: z.int().min(0),
      changes: z.record(z.string(), z.tuple([z.number(), z.number()])),
    })
    .nullable(),
  /** No heir and nobody to take the burden: the chronicle is over. */
  ended: z.boolean(),
});

export function emptyLineage(): z.infer<typeof LineageStateSchema> {
  return {
    deaths: [],
    awaitingHeir: false,
    guardian: null,
    since: null,
    deeds: { chapters: 0, mysteries: 0, buildings: 0, routes: 0 },
    past: [],
    bloodline: [],
    baseline: null,
    summary: null,
    ended: false,
  };
}

/** The Endless Chronicle (docs/systems/endless-chronicle.md → Implementation). */
export const EndlessStateSchema = z.strictObject({
  /** Any route ending unlocks it. */
  unlocked: z.boolean(),
  active: z.boolean(),
  /** Chosen Darkness level (0: none) and the highest ever played. */
  darkness: z.int().min(0).max(10),
  best: z.int().min(0).max(10),
  years: z.int().min(0),
  /** Procedural mysteries of the last years (registered in the content database on load). */
  generated: z.array(Mystery).max(50),
  /** Newcomer families of the endless years (registered as villagers on load), and birth years. */
  villagers: z.array(Villager).max(200),
  born: z.record(Id, z.int()),
  nextId: z.int().min(1),
  /** Relic talents chosen: "tree/cell" → the relic talent that replaces the cell's own. */
  swaps: z.record(z.string(), Id),
  /** Chronicle goals already rewarded. */
  goals: z.array(Id).max(500),
  /** Harvest or disaster drawn each year. */
  harvests: z.array(z.strictObject({ year: z.int(), harvest: Id })).max(200),
});

export function emptyEndless(): z.infer<typeof EndlessStateSchema> {
  return {
    unlocked: false,
    active: false,
    darkness: 0,
    best: 0,
    years: 0,
    generated: [],
    villagers: [],
    born: {},
    nextId: 1,
    swaps: {},
    goals: [],
    harvests: [],
  };
}

export const PacingPhaseSchema = z.enum(['settle', 'build', 'peak', 'release']);
export const EvidenceMethodSchema = z.enum(['photograph', 'witness', 'relic']);

/** One director tick, for the debug console (never shown to the player). */
export const DirectorDecisionSchema = z.strictObject({
  /** Absolute minute (day × 1440 + minute). */
  at: z.int(),
  night: z.int(),
  phase: PacingPhaseSchema,
  target: z.number(),
  tension: z.number(),
  p: z.number(),
  roll: z.number().nullable(),
  outcome: z.enum(['fired', 'quiet', 'held', 'no-candidates']),
  event: Id.nullable(),
  category: z.string().nullable(),
  candidates: z.int().min(0),
  shares: z.record(z.string(), z.number()),
  factors: z.record(z.string(), z.number()),
});
export type DirectorDecision = z.infer<typeof DirectorDecisionSchema>;

export const OccurrenceSchema = z.strictObject({
  id: z.int().min(1),
  event: Id,
  at: z.int(),
  zone: Id.nullable(),
  /** Hidden truth: never shown by the UI; read only by evidence rolls. */
  hallucination: z.boolean(),
  /** Evidence methods already used on it. */
  examined: z.array(EvidenceMethodSchema).max(3),
});
export type Occurrence = z.infer<typeof OccurrenceSchema>;

export const DirectorStateSchema = z.strictObject({
  tension: z.number().min(0).max(100),
  /** Day the current night started on. */
  night: z.int().nullable(),
  /** Tension cost spent this night, by pacing phase. */
  spent: z.record(z.string(), z.number().min(0)),
  /** Event → absolute minute it can fire again. */
  cooldowns: z.record(Id, z.int()),
  /** Absolute minutes of recent fires (last hour). */
  recent: z.array(z.int()).max(50),
  quietUntil: z.int().nullable(),
  occurrences: z.array(OccurrenceSchema).max(100),
  nextOccurrence: z.int().min(1),
  log: z.array(DirectorDecisionSchema).max(1000),
});

export const HysteriaStateSchema = z.strictObject({
  mob: z
    .strictObject({
      /** A villager id, or "guardian". */
      target: Id,
      size: z.int().min(0),
      formedDay: z.int(),
      confronted: z.boolean(),
      /** The guardian steered or exploited it (shares the guilt of what it does). */
      complicit: z.boolean(),
    })
    .nullable(),
  accusations: z.array(z.strictObject({ day: z.int(), target: Id })).max(200),
  trials: z
    .array(
      z.strictObject({
        day: z.int(),
        target: Id,
        verdict: z.enum(['spared', 'beaten', 'lynched']),
        innocent: z.boolean(),
      }),
    )
    .max(200),
  /** Hysteria rose since the last dawn (no natural decay). */
  incident: z.boolean(),
});

export const ExorcismPhaseSchema = z.enum(['preparation', 'confrontation', 'naming', 'expulsion']);
export type ExorcismPhase = z.infer<typeof ExorcismPhaseSchema>;

/** A rite in progress (docs/systems/exorcism.md → Implementation). */
export const ExorcismStateSchema = z.strictObject({
  host: Id,
  phase: ExorcismPhaseSchema,
  /** Items laid out in the preparation (consumed). */
  prepared: z.array(Id).max(8),
  /** Taunts spoken in the confrontation: template key and params (localization keys). */
  taunts: z
    .array(z.strictObject({ key: z.string(), params: z.record(z.string(), z.string()) }))
    .max(8),
  progress: z.number().min(0),
  round: z.int().min(0),
});

export const EncounterSchema = z.strictObject({
  id: z.int().min(1),
  creature: Id,
  zone: Id,
  poi: Id,
  health: z.number().min(0),
  state: z.enum(['active', 'banished', 'evaded', 'defeated']),
  /** A successful dodge waits for the creature's next blow. */
  dodge: z.boolean(),
});
export type Encounter = z.infer<typeof EncounterSchema>;

export const NightStateSchema = z.strictObject({
  /** Day the current night started on. */
  day: z.int().nullable(),
  /** "zone/poi" places the evil may come from, and the one it does. */
  candidates: z.array(z.string()).max(20),
  origin: z.string().nullable(),
  checked: z.array(z.string()).max(20),
  found: z.boolean(),
  completed: z.boolean(),
  encounters: z.array(EncounterSchema).max(50),
  nextEncounter: z.int().min(1),
});

export function emptyNight(): z.infer<typeof NightStateSchema> {
  return {
    day: null,
    candidates: [],
    origin: null,
    checked: [],
    found: false,
    completed: false,
    encounters: [],
    nextEncounter: 1,
  };
}

export function emptyFearState(): Pick<WorldState, 'director' | 'hysteria' | 'sanity'> {
  return {
    director: {
      tension: 0,
      night: null,
      spent: {},
      cooldowns: {},
      recent: [],
      quietUntil: null,
      occurrences: [],
      nextOccurrence: 1,
      log: [],
    },
    hysteria: { mob: null, accusations: [], trials: [], incident: false },
    sanity: { tier: 0, broken: false, breaks: 0 },
  };
}

export const WorldStateSchema = z.strictObject({
  clock: ClockStateSchema,
  calendar: z.strictObject({
    chapterId: Id.nullable(),
    chapterStart: z.int().nullable(),
    nightIndex: z.int().min(0),
  }),
  /** Set flags (a flag is either present and true, or absent). */
  flags: z.record(Id, z.literal(true)),
  /** Global stats (guardian, village, world, profile scopes); absent = registry default. */
  stats: z.record(Id, z.number()),
  /** Villager-scoped stats: villager → stat → value. */
  villagerStats: z.record(Id, z.record(Id, z.number())),
  /** Engine counters (not content stats). */
  counters: z.record(Id, z.number()),
  zones: z.record(
    Id,
    z.strictObject({
      /** Explicit variant set by an effect; null = derive from the zone's conditions. */
      variant: Id.nullable(),
      discovered: z.boolean(),
      visits: z.int().min(0),
      /** Explored cells (bitset, base64) for the player map. */
      explored: z.string().max(12_000),
      /** Points of interest the guardian has discovered. */
      pois: z.array(Id),
      /** POIs whose one-time effects were applied. */
      used: z.array(Id),
    }),
  ),
  currentZone: Id.nullable(),
  /** The guardian's lantern (docs/systems/light.md). */
  light: z.strictObject({
    lantern: Id.nullable(),
    lit: z.boolean(),
    fuel: z.number().min(0).max(1),
    inDarkness: z.boolean(),
    /** Darkness minutes not yet turned into Sanity loss. */
    darkMinutes: z.number().min(0),
  }),
  /** Transient exploration state of the guardian. */
  explorer: z.strictObject({ noise: z.number().min(0).max(10) }),
  villagers: z.record(Id, VillagerStateSchema),
  /** Village-wide simulation state (docs/systems/villagers.md → Implementation). */
  village: z.strictObject({
    /** Homes with a fire tonight (firewood burned at nightfall). */
    heated: z.array(Id),
    /** Meal portions left from the loaf already cut. */
    portions: z.int().min(0).max(100),
    ...GrowthStateShape,
  }),
  guardian: z.strictObject({
    callingId: Id.nullable(),
    /** Bought tree cells, "tree/cell" (docs/systems/progression.md T1–T3). */
    talents: z.array(z.string()),
    /** Carried stacks, in insertion order. */
    pack: z.array(StackSchema).max(64),
    /** The house store: one stack per item and potency, no limits. */
    storage: z.array(StackSchema).max(1000),
    /** Stacks left on the ground, by zone. */
    ground: z.record(Id, z.array(StackSchema).max(64)),
    collectibles: z.array(Id),
    unlockedTrees: z.array(Id),
    unlockedRecipes: z.array(Id),
    ...ProgressionStateSchema.shape,
  }),
  /** Collection, cabinet, album and gathering (docs/systems/collection.md, photography.md). */
  collection: z.strictObject({
    /** Cursed items displayed in the cellar cabinet. */
    cabinet: z.array(Id).max(24),
    /** Cursed objects whose memory was recalled. */
    memories: z.array(Id),
    /** Items ever obtained. */
    found: z.array(Id),
    /** Villager → last day the guardian talked to them. */
    talked: z.record(Id, z.int()),
    /** Photo layers ever revealed. */
    layers: z.array(Id),
    album: z.array(PhotoSchema).max(200),
    nextPhoto: z.int().min(1),
    /** "zone/poi" → day of the last gathering. */
    gathered: z.record(z.string(), z.int()),
  }),
  /** The journal of experiments (docs/systems/alchemy.md). */
  alchemy: z.strictObject({ attempts: z.array(AttemptSchema).max(500) }),
  quests: z.record(Id, z.strictObject({ status: z.enum(['active', 'done', 'failed']), stage: Id })),
  mysteries: z.record(
    Id,
    z.strictObject({
      status: z.enum(['active', 'concluded', 'unsolved']),
      clues: z.array(Id),
      conclusion: z
        .strictObject({
          culprit: Id,
          correct: z.boolean(),
          cause: Id.optional(),
          remedy: Id.optional(),
        })
        .nullable(),
      /** Red threads on the board: a clue tied to a proposition ("culprit:x"…). */
      links: z.array(z.strictObject({ clue: Id, proposition: z.string().max(80) })).max(500),
      /** Card positions on the board (clue ids and propositions). */
      board: z.record(z.string().max(80), z.strictObject({ x: z.number(), y: z.number() })),
      /** Clues retracted when a lying witness was exposed. */
      retracted: z.array(Id),
    }),
  ),
  pacts: z.record(
    Id,
    z.strictObject({
      signedAt: GameTimeSchema,
      /** Hidden clauses: the day a delayed one comes due (null: by condition) and whether it fired. */
      clauses: z.record(Id, z.strictObject({ dueDay: z.int().nullable(), fired: z.boolean() })),
    }),
  ),
  /** Sacrifices made (docs/systems/sacrifices.md); a doomed target dies on `dueDay`. */
  sacrifices: z
    .array(
      z.strictObject({
        id: Id,
        day: z.int(),
        target: Id.nullable(),
        dueDay: z.int().nullable(),
        witnessed: z.boolean(),
      }),
    )
    .max(500),
  debt: z.strictObject({
    entries: z.array(
      z.strictObject({ source: Id, amount: z.int(), creditor: Id, at: GameTimeSchema }),
    ),
    history: z.array(DebtHistorySchema).max(500),
    /** Day of the last night with a collection (one per night). */
    lastNight: z.int().nullable(),
  }),
  journal: JournalStateSchema,
  possessions: z.array(
    z.strictObject({ demon: Id, host: Id, stage: z.int().min(1).max(5), revealed: z.boolean() }),
  ),
  modifiers: z.array(z.strictObject({ source: z.string(), modifier: Modifier })),
  abilities: z.record(
    z.string(),
    z.strictObject({
      source: z.string(),
      uses: z.int().min(1),
      per: UsePeriod,
      usesLeft: z.int().min(0),
      effects: z.array(Effect),
      cooldown: z.int().min(1).optional(),
      cost: z.strictObject({ sanity: z.int().optional(), light: z.number().optional() }).optional(),
      /** Absolute minute (day × 1440 + minute) when it can be used again. */
      readyAt: z.int().optional(),
    }),
  ),
  decisions: z.array(
    z.strictObject({
      id: Id,
      choice: z.string(),
      at: GameTimeSchema,
      context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
  ),
  narrations: z.array(z.strictObject({ key: z.string(), at: GameTimeSchema })),
  director: DirectorStateSchema,
  hysteria: HysteriaStateSchema,
  /** Sanity tier shown to the presentation layer, and the break state. */
  sanity: z.strictObject({ tier: z.int().min(0), broken: z.boolean(), breaks: z.int().min(0) }),
  exorcism: ExorcismStateSchema.nullable(),
  /** Tonight's expedition (docs/systems/night-exploration.md → Implementation). */
  night: NightStateSchema,
  /** Deaths of guardians; the heir takes over (docs/systems/lineage.md). */
  lineage: LineageStateSchema,
  endless: EndlessStateSchema,
  /** Real-date seasonal events already activated ("event@year"). */
  seasonal: z.strictObject({ activated: z.array(z.string().max(80)).max(500) }),
  playtimeMs: z.number().min(0),
});

export type WorldState = z.infer<typeof WorldStateSchema>;
export type GameTime = z.infer<typeof GameTimeSchema>;
export type ClockState = z.infer<typeof ClockStateSchema>;

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Immutable view handed to React, Phaser and Ink. */
export type Snapshot = DeepReadonly<WorldState>;

export interface NewGameOptions {
  /** Chronicle start in data/starts (default: "default"; "prologue" is Stana's last days). */
  startId?: string;
  /** Julian date the chronicle starts on (default: Christmas 1834). */
  start?: CalendarDate;
  /** Minute of the start day (default 08:00). */
  startMinute?: number;
  callingId?: string;
  startZone?: string;
  /** Lantern gear equipped at the start. */
  lantern?: string;
}

/** A fresh state built from content (villagers, zones…). */
export function createInitialState(db: ContentDatabase, options: NewGameOptions = {}): WorldState {
  const start = options.start ?? { year: 1834, month: 12, day: 25 };
  const state: WorldState = {
    clock: {
      day: julianToJdn(start),
      minute: options.startMinute ?? 8 * 60,
      subMinute: 0,
      speed: 1,
      paused: false,
    },
    calendar: { chapterId: null, chapterStart: null, nightIndex: 0 },
    flags: {},
    stats: {},
    villagerStats: {},
    counters: {},
    zones: {},
    currentZone: options.startZone ?? null,
    light: {
      lantern: options.lantern ?? null,
      lit: false,
      fuel: 0,
      inDarkness: false,
      darkMinutes: 0,
    },
    explorer: { noise: 0 },
    villagers: {},
    village: { heated: [], portions: 0, ...emptyGrowth(), year: start.year },
    guardian: {
      callingId: options.callingId ?? null,
      talents: [],
      pack: [],
      storage: [],
      ground: {},
      collectibles: [],
      unlockedTrees: [],
      unlockedRecipes: [],
      ...emptyProgression(),
    },
    collection: emptyCollection(),
    alchemy: { attempts: [] },
    quests: {},
    mysteries: {},
    pacts: {},
    sacrifices: [],
    debt: { entries: [], history: [], lastNight: null },
    journal: emptyJournal(),
    possessions: [],
    modifiers: [],
    abilities: {},
    decisions: [],
    narrations: [],
    ...emptyFearState(),
    exorcism: null,
    night: emptyNight(),
    lineage: emptyLineage(),
    endless: emptyEndless(),
    seasonal: { activated: [] },
    playtimeMs: 0,
  };
  return reconcileWithContent(state, db);
}

/**
 * Adds what content defines but the state lacks (new villagers or zones after a content update,
 * migrated saves). Never removes anything.
 */
export function reconcileWithContent(state: WorldState, db: ContentDatabase): WorldState {
  for (const villager of db.all('villagers')) {
    if (state.villagers[villager.id]) continue;
    const affinity: Record<string, number> = {};
    for (const r of villager.relationships) affinity[r.villager] = r.affinity;
    state.villagers[villager.id] = newVillagerState(affinity);
    state.villagerStats[villager.id] = {
      fear: villager.startingFear,
      ...state.villagerStats[villager.id],
    };
  }
  for (const zone of db.all('zones')) {
    state.zones[zone.id] ??= emptyZoneState();
  }
  if (state.currentZone !== null && !db.has('zones', state.currentZone)) state.currentZone = null;
  return state;
}

export function emptyCollection(): WorldState['collection'] {
  return {
    cabinet: [],
    memories: [],
    found: [],
    talked: {},
    layers: [],
    album: [],
    nextPhoto: 1,
    gathered: {},
  };
}

export function emptyZoneState(): WorldState['zones'][string] {
  return { variant: null, discovered: false, visits: 0, explored: '', pois: [], used: [] };
}

/** Deep copy of plain JSON state (no structuredClone: core targets ES2023 without DOM libs). */
export function cloneState<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => cloneState(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneState(v);
    return out as T;
  }
  return value;
}

/** Freezes recursively; skips subtrees already frozen (cheap with structural sharing). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
