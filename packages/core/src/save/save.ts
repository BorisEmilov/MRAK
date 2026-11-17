/**
 * SaveModel: versioned serialization of the whole game (docs/systems/save-system.md).
 * A save holds the WorldState, the RNG seed and stream states, and metadata. Old versions are
 * migrated step by step (v1 → v2 → …) and the result is validated before use.
 */
import { z } from 'zod';
import { jdnToJulian } from '../time/calendar';
import {
  emptyCollection,
  emptyFearState,
  emptyJournal,
  emptyNight,
  emptyEndless,
  emptyGrowth,
  emptyLineage,
  emptyProgression,
  newVillagerState,
  WorldStateSchema,
  type WorldState,
} from '../state/world-state';

export const SAVE_FORMAT = 'mrak-save';
export const SAVE_VERSION = 14;

/** Hard limit on a serialized save (save-system.md: ≤ 1 MB compressed; we check raw size). */
export const MAX_SAVE_BYTES = 4 * 1024 * 1024;

export class SaveError extends Error {
  override readonly name: string = 'SaveError';
}

/** The save was written by a newer version of the game: not corrupt, just not loadable here. */
export class SaveTooNewError extends SaveError {
  override readonly name = 'SaveTooNewError';
}

export const SaveMetaSchema = z.strictObject({
  gameDate: z.strictObject({
    year: z.int(),
    month: z.int().min(1).max(12),
    day: z.int().min(1).max(31),
    minute: z.int().min(0).max(1439),
  }),
  zone: z.string().nullable(),
  playtimeMs: z.number().min(0),
  /** Bloodline generation (world stat `generation`), shown on the load screen. */
  generation: z.int().min(1),
  contentVersion: z.string(),
  contentHash: z.string().optional(),
});

export const SaveFileSchema = z.strictObject({
  format: z.literal(SAVE_FORMAT),
  version: z.literal(SAVE_VERSION),
  /** Real-world time of saving (ISO 8601), injected by the caller. */
  savedAt: z.string(),
  meta: SaveMetaSchema,
  rng: z.strictObject({ seed: z.int().min(0), streams: z.record(z.string(), z.int().min(0)) }),
  state: WorldStateSchema,
});
export type SaveFile = z.infer<typeof SaveFileSchema>;
export type SaveMeta = z.infer<typeof SaveMetaSchema>;

/** Generation of the bloodline in a state (world stat `generation`, default 1). */
export function generationOf(state: Pick<WorldState, 'stats'>): number {
  const value = state.stats['generation'];
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : 1;
}

/** Metadata derived from the state. */
export function metaOf(
  state: Pick<WorldState, 'clock' | 'currentZone' | 'playtimeMs' | 'stats'>,
  content: { version: string; hash?: string | undefined },
): SaveMeta {
  const date = jdnToJulian(state.clock.day);
  return {
    gameDate: { ...date, minute: state.clock.minute },
    zone: state.currentZone,
    playtimeMs: state.playtimeMs,
    generation: generationOf(state),
    contentVersion: content.version,
    ...(content.hash !== undefined ? { contentHash: content.hash } : {}),
  };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * v1 — the prototype format: flat `world` object, flags as a list, one RNG state, playtime in
 * seconds, no decisions log, no per-zone state.
 */
export const SaveV1Schema = z.strictObject({
  version: z.literal(1),
  savedAt: z.string(),
  seed: z.int().min(0),
  rngState: z.int().min(0),
  contentVersion: z.string(),
  world: z.strictObject({
    day: z.int(),
    minute: z.int().min(0).max(1439),
    flags: z.array(z.string()),
    stats: z.record(z.string(), z.number()),
    inventory: z.record(z.string(), z.int().min(1)),
    villagers: z.record(
      z.string(),
      z.strictObject({ alive: z.boolean(), affinity: z.record(z.string(), z.number()) }),
    ),
    zone: z.string().nullable(),
    playtimeSeconds: z.number().min(0),
  }),
});

function migrateV1toV2(input: unknown): unknown {
  const v1 = SaveV1Schema.parse(input);
  const w = v1.world;
  // The v2 state shape (later fields are added by later migrations).
  const state = {
    clock: { day: w.day, minute: w.minute, subMinute: 0, speed: 1, paused: false },
    calendar: { chapterId: null, chapterStart: null, nightIndex: 0 },
    flags: Object.fromEntries(w.flags.map((f) => [f, true as const])),
    stats: w.stats,
    villagerStats: {},
    counters: {},
    zones: {},
    currentZone: w.zone,
    villagers: w.villagers,
    guardian: {
      callingId: null,
      talents: [],
      inventory: w.inventory,
      collectibles: [],
      unlockedTrees: [],
      unlockedRecipes: [],
    },
    quests: {},
    mysteries: {},
    pacts: {},
    debt: { entries: [] },
    possessions: [],
    modifiers: [],
    abilities: {},
    decisions: [],
    narrations: [],
    playtimeMs: w.playtimeSeconds * 1000,
  };
  return {
    format: SAVE_FORMAT,
    version: 2,
    savedAt: v1.savedAt,
    meta: metaOf(state, { version: v1.contentVersion }),
    // v1 had a single stream, used by the event director.
    rng: { seed: v1.seed, streams: { director: v1.rngState } },
    state,
  };
}

/** v2 → v3: `meta.generation` added (derived from the saved stats). */
function migrateV2toV3(input: unknown): unknown {
  const v2 = z
    .looseObject({
      version: z.literal(2),
      meta: z.looseObject({}),
      state: z.looseObject({ stats: z.record(z.string(), z.number()) }),
    })
    .parse(input);
  return { ...v2, version: 3, meta: { ...v2.meta, generation: generationOf(v2.state) } };
}

/** v3 → v4: lantern/light, explorer noise, and per-zone exploration (night-exploration.md). */
function migrateV3toV4(input: unknown): unknown {
  const v3 = z
    .looseObject({
      version: z.literal(3),
      state: z.looseObject({
        zones: z.record(z.string(), z.looseObject({})),
      }),
    })
    .parse(input);
  const zones = Object.fromEntries(
    Object.entries(v3.state.zones).map(([id, zone]) => [
      id,
      { ...zone, explored: '', pois: [], used: [] },
    ]),
  );
  return {
    ...v3,
    version: 4,
    state: {
      ...v3.state,
      zones,
      light: { lantern: null, lit: false, fuel: 0, inDarkness: false, darkMinutes: 0 },
      explorer: { noise: 0 },
    },
  };
}

/** v4 → v5: villager status, tasks and death; village simulation state (villagers.md). */
function migrateV4toV5(input: unknown): unknown {
  const v4 = z
    .looseObject({
      version: z.literal(4),
      state: z.looseObject({
        villagers: z.record(
          z.string(),
          z.looseObject({ alive: z.boolean(), affinity: z.record(z.string(), z.number()) }),
        ),
      }),
    })
    .parse(input);
  const villagers = Object.fromEntries(
    Object.entries(v4.state.villagers).map(([id, v]) => [
      id,
      {
        ...newVillagerState(v.affinity),
        alive: v.alive,
        status: v.alive ? 'healthy' : 'dead',
        // Saves before v5 had no burials: the dead of old chronicles rest in peace.
        death: v.alive
          ? null
          : { day: 0, minute: 0, cause: 'unknown', burial: 'proper', nightsReturned: 0 },
      },
    ]),
  );
  return {
    ...v4,
    version: 5,
    state: { ...v4.state, villagers, village: { heated: [], portions: 0 } },
  };
}

/** The item the lantern burns: kept in the pack by the v5 → v6 migration. */
const V6_PACK_ITEMS: ReadonlySet<string> = new Set(['lamp-oil']);

/**
 * v5 → v6: the flat inventory becomes the pack (lantern oil) and the house store (everything
 * else); collection and alchemy state start empty (docs/systems/inventory.md).
 */
function migrateV5toV6(input: unknown): unknown {
  const v5 = z
    .looseObject({
      version: z.literal(5),
      state: z.looseObject({
        guardian: z.looseObject({ inventory: z.record(z.string(), z.int().min(1)).optional() }),
      }),
    })
    .parse(input);
  const { inventory = {}, ...guardian } = v5.state.guardian;
  const entries = Object.entries(inventory);
  return {
    ...v5,
    version: 6,
    state: {
      ...v5.state,
      guardian: {
        pack: entries.filter(([id]) => V6_PACK_ITEMS.has(id)).map(([item, qty]) => ({ item, qty })),
        storage: entries
          .filter(([id]) => !V6_PACK_ITEMS.has(id))
          .map(([item, qty]) => ({ item, qty })),
        ground: {},
        // Fields already in the shape of v6 (saves written by tests from a newer state) win.
        ...guardian,
      },
      collection: v5.state['collection'] ?? {
        ...emptyCollection(),
        found: entries.map(([id]) => id),
      },
      alchemy: v5.state['alchemy'] ?? { attempts: [] },
    },
  };
}

/**
 * v6 → v7: guardian progression, debt history and the journal start empty
 * (docs/systems/progression.md §1). Talents were talent ids, now "tree/cell" (none were sold yet).
 */
function migrateV6toV7(input: unknown): unknown {
  const v6 = z
    .looseObject({
      version: z.literal(6),
      state: z.looseObject({
        guardian: z.looseObject({}),
        debt: z.looseObject({}),
        abilities: z.record(z.string(), z.looseObject({})).optional(),
      }),
    })
    .parse(input);
  const g = v6.state.guardian;
  return {
    ...v6,
    version: 7,
    state: {
      ...v6.state,
      guardian: {
        ...emptyProgression(),
        ...g,
        talents: Array.isArray(g['talents'])
          ? (g['talents'] as unknown[]).filter((t) => typeof t === 'string' && t.includes('/'))
          : [],
      },
      debt: { history: [], lastNight: null, ...v6.state.debt },
      journal: v6.state['journal'] ?? emptyJournal(),
    },
  };
}

/** v8: the fear engine (director, hysteria and sanity tier state). */
function migrateV7toV8(input: unknown): unknown {
  const v7 = z.looseObject({ version: z.literal(7), state: z.looseObject({}) }).parse(input);
  return { ...v7, version: 8, state: { ...emptyFearState(), ...v7.state } };
}

/** v9: the exorcism in progress. */
function migrateV8toV9(input: unknown): unknown {
  const v8 = z.looseObject({ version: z.literal(8), state: z.looseObject({}) }).parse(input);
  return { ...v8, version: 9, state: { exorcism: null, ...v8.state } };
}

/** v10: hidden clause schedules on pacts, sacrifices made. */
function migrateV9toV10(input: unknown): unknown {
  const v9 = z
    .looseObject({
      version: z.literal(9),
      state: z.looseObject({ pacts: z.record(z.string(), z.looseObject({})).optional() }),
    })
    .parse(input);
  const pacts = Object.fromEntries(
    Object.entries(v9.state.pacts ?? {}).map(([id, p]) => [id, { clauses: {}, ...p }]),
  );
  return { ...v9, version: 10, state: { sacrifices: [], ...v9.state, pacts } };
}

/** v11: the deduction board (links, card positions, retracted clues). */
function migrateV10toV11(input: unknown): unknown {
  const v10 = z
    .looseObject({
      version: z.literal(10),
      state: z.looseObject({ mysteries: z.record(z.string(), z.looseObject({})).optional() }),
    })
    .parse(input);
  const mysteries = Object.fromEntries(
    Object.entries(v10.state.mysteries ?? {}).map(([id, m]) => [
      id,
      { links: [], board: {}, retracted: [], ...m },
    ]),
  );
  return { ...v10, version: 11, state: { ...v10.state, mysteries } };
}

/** v12: night expeditions and the lineage of guardians. */
function migrateV11toV12(input: unknown): unknown {
  const v11 = z.looseObject({ version: z.literal(11), state: z.looseObject({}) }).parse(input);
  return {
    ...v11,
    version: 12,
    state: { night: emptyNight(), lineage: { deaths: [], awaitingHeir: false }, ...v11.state },
  };
}

/** v13: village growth (buildings, residents, years) and the full lineage. */
function migrateV12toV13(input: unknown): unknown {
  const v12 = z
    .looseObject({
      version: z.literal(12),
      state: z.looseObject({ village: z.looseObject({}), lineage: z.looseObject({}).optional() }),
    })
    .parse(input);
  return {
    ...v12,
    version: 13,
    state: {
      ...v12.state,
      village: { ...emptyGrowth(), ...v12.state.village },
      lineage: { ...emptyLineage(), ...v12.state.lineage },
    },
  };
}

/** v14: the Endless Chronicle and real-date seasonal events. */
function migrateV13toV14(input: unknown): unknown {
  const v13 = z.looseObject({ version: z.literal(13), state: z.looseObject({}) }).parse(input);
  return {
    ...v13,
    version: 14,
    state: { endless: emptyEndless(), seasonal: { activated: [] }, ...v13.state },
  };
}

/** Migration from version N (key) to N + 1. */
export const MIGRATIONS: Readonly<Record<number, (save: unknown) => unknown>> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
  6: migrateV6toV7,
  7: migrateV7toV8,
  8: migrateV8toV9,
  9: migrateV9toV10,
  10: migrateV10toV11,
  11: migrateV11toV12,
  12: migrateV12toV13,
  13: migrateV13toV14,
};

function versionOf(data: unknown): number {
  if (
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    typeof data.version === 'number'
  ) {
    return data.version;
  }
  throw new SaveError('not a MRAK save (no version)');
}

/** Upgrades any supported version to the current one and validates it. */
export function migrateSave(data: unknown): { save: SaveFile; migratedFrom: number | null } {
  const original = versionOf(data);
  if (original > SAVE_VERSION) {
    throw new SaveTooNewError(
      `save version ${String(original)} is newer than this game (${String(SAVE_VERSION)})`,
    );
  }
  let current = data;
  for (let v = original; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new SaveError(`no migration from save version ${String(v)}`);
    try {
      current = step(current);
    } catch (err) {
      throw new SaveError(
        `migration v${String(v)}→v${String(v + 1)} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const result = SaveFileSchema.safeParse(current);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new SaveError(
      `invalid save: ${first ? `${first.path.join('.')}: ${first.message}` : 'unknown'}`,
    );
  }
  return { save: result.data, migratedFrom: original === SAVE_VERSION ? null : original };
}

/** Canonical JSON: object keys sorted, so the same save always gives the same text (checksum). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const source = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = source[key];
    return sorted;
  });
}

export function serializeSave(save: SaveFile): string {
  return canonicalJson(save);
}

export function deserializeSave(text: string): { save: SaveFile; migratedFrom: number | null } {
  if (text.length > MAX_SAVE_BYTES) throw new SaveError('save file too large');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SaveError('save file is not valid JSON');
  }
  return migrateSave(data);
}
