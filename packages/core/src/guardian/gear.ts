/**
 * Gear and blessings (docs/systems/progression.md G1–G5): equipment slots, blessing slots with
 * durations and conflicts, workshop upgrades.
 */
import type { Gear, ProgressionRules } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import { event, type CoreEvent } from '../events';
import { itemCount, takeItem } from '../items/inventory';
import type { IRandom } from '../random';
import { EQUIP_SLOTS, type EquipSlot, type WorldState } from '../state/world-state';
import { resolveCheck, type ResolvedCheck } from './checks';
import { isNight, ProgressionError, type ReadState } from './rules';

/** Slots a piece of gear fits (amulets: either amulet slot). */
export function slotsFor(gear: Gear): EquipSlot[] {
  if (gear.slot === 'amulet') return ['amulet', 'amulet-2'];
  if (gear.slot === 'lantern') return [];
  return [gear.slot];
}

export function ownsGear(state: ReadState, gearId: string): boolean {
  return state.guardian.gear.includes(gearId) || state.light.lantern === gearId;
}

/** Blessing slots of a piece of gear, upgrades included. */
export function blessingSlots(state: ReadState, gear: Gear): number {
  return (
    gear.blessingSlots +
    (state.guardian.upgrades[gear.id] ?? []).reduce(
      (s, u) => s + (gear.upgrades.find((x) => x.id === u)?.blessingSlots ?? 0),
      0,
    )
  );
}

/** G1: in the village anytime; elsewhere not at night. */
function assertSafeToChange(state: ReadState, rules: ProgressionRules): void {
  if (isNight(state) && state.currentZone !== rules.gear.workshopZone)
    throw new ProgressionError('not safe here');
}

export function equipGear(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  slot: EquipSlot,
  gearId: string | null,
): CoreEvent[] {
  if (!EQUIP_SLOTS.includes(slot)) throw new ProgressionError('unknown slot');
  assertSafeToChange(draft, rules);
  if (gearId !== null) {
    const gear = db.get('gear', gearId);
    if (!draft.guardian.gear.includes(gearId)) throw new ProgressionError('not owned');
    if (!slotsFor(gear).includes(slot)) throw new ProgressionError('wrong slot');
    const next: WorldState['guardian']['equipment'] = {};
    for (const s of EQUIP_SLOTS) {
      const current = draft.guardian.equipment[s];
      if (current !== undefined && current !== gearId) next[s] = current;
    }
    next[slot] = gearId;
    draft.guardian.equipment = next;
  } else {
    draft.guardian.equipment = Object.fromEntries(
      Object.entries(draft.guardian.equipment).filter(([s]) => s !== slot),
    );
  }
  return [event('gear/equipped', { slot, gear: gearId })];
}

/** Grants gear (creation, rewards) and equips it into a free slot. */
export function grantGear(draft: WorldState, db: ContentDatabase, gearId: string): CoreEvent[] {
  const gear = db.get('gear', gearId);
  if (!draft.guardian.gear.includes(gearId)) draft.guardian.gear.push(gearId);
  const free = slotsFor(gear).find((s) => draft.guardian.equipment[s] === undefined);
  if (!free) return [];
  draft.guardian.equipment[free] = gearId;
  return [event('gear/equipped', { slot: free, gear: gearId })];
}

function hasMaterials(
  state: ReadState,
  materials: readonly { item: string; qty: number }[],
): boolean {
  return materials.every((m) => itemCount(state, m.item, 'any') >= m.qty);
}

/** Why a blessing cannot be applied now, or null (G3). */
export function blessingProblem(
  state: ReadState,
  db: ContentDatabase,
  rules: ProgressionRules,
  gearId: string,
  blessingId: string,
): string | null {
  const gear = db.find('gear', gearId);
  const blessing = db.find('blessings', blessingId);
  if (!gear || !blessing) return 'unknown';
  if (!ownsGear(state, gearId)) return 'not owned';
  if (!blessing.appliesTo.includes(gear.slot)) return 'wrong gear';
  const live = (state.guardian.blessings[gearId] ?? []).filter((b) => b.blessing !== blessingId);
  const conflicting = live.filter((b) => conflicts(db, blessingId, b.blessing)).length;
  if (live.length - conflicting >= blessingSlots(state, gear)) return 'no free slot';
  if (blessing.station && state.currentZone !== rules.gear.workshopZone) return 'wrong place';
  if (!hasMaterials(state, blessing.materials)) return 'missing materials';
  return null;
}

/** Holy and dark drive each other out; explicit conflicts too. */
function conflicts(db: ContentDatabase, a: string, b: string): boolean {
  const x = db.find('blessings', a);
  const y = db.find('blessings', b);
  if (!x || !y) return false;
  const opposed =
    (x.power === 'holy' && y.power === 'dark') || (x.power === 'dark' && y.power === 'holy');
  return opposed || x.conflictsWith.includes(b) || y.conflictsWith.includes(a);
}

export function blessGear(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  gearId: string,
  blessingId: string,
  rng: IRandom,
): { events: CoreEvent[]; check: ResolvedCheck } {
  const problem = blessingProblem(draft, db, rules, gearId, blessingId);
  if (problem) throw new ProgressionError(problem);
  const blessing = db.get('blessings', blessingId);
  for (const m of blessing.materials) takeItem(draft, db, m.item, m.qty);
  const check = resolveCheck(
    draft,
    db,
    rules,
    {
      skill: blessing.check.skill,
      difficulty: blessing.check.difficulty,
      context: 'blessing',
      target: gearId,
    },
    rng,
  );
  const events: CoreEvent[] = [...check.events];
  if (!check.result.success) {
    events.push(event('gear/blessingFailed', { gear: gearId, blessing: blessingId }));
    return { events, check };
  }
  const list = (draft.guardian.blessings[gearId] ??= []);
  const removed = list.filter(
    (b) => b.blessing === blessingId || conflicts(db, blessingId, b.blessing),
  );
  for (const r of removed)
    if (r.blessing !== blessingId)
      events.push(event('gear/blessingExpired', { gear: gearId, blessing: r.blessing }));
  draft.guardian.blessings[gearId] = list.filter((b) => !removed.includes(b));
  const bonus = check.result.omen === 'good' || check.result.omen === 'great' ? 1 : 0;
  const d = blessing.duration;
  draft.guardian.blessings[gearId].push({
    blessing: blessingId,
    usesLeft: 'uses' in d ? d.uses + bonus : null,
    nightsLeft: 'nights' in d ? d.nights + bonus : null,
  });
  events.push(event('gear/blessed', { gear: gearId, blessing: blessingId, bonus }));
  return { events, check };
}

/** Blessings counted in nights lose one at dawn (G4); spent ones are removed. */
export function blessingsAtDawn(draft: WorldState): CoreEvent[] {
  const events: CoreEvent[] = [];
  for (const [gear, list] of Object.entries(draft.guardian.blessings)) {
    for (const b of list) {
      if (b.nightsLeft === null) continue;
      b.nightsLeft = Math.max(0, b.nightsLeft - 1);
      if (b.nightsLeft === 0)
        events.push(event('gear/blessingExpired', { gear, blessing: b.blessing }));
    }
    draft.guardian.blessings[gear] = list.filter((b) => b.nightsLeft !== 0 && b.usesLeft !== 0);
  }
  return events;
}

export function upgradeGear(
  draft: WorldState,
  db: ContentDatabase,
  rules: ProgressionRules,
  gearId: string,
  upgradeId: string,
): CoreEvent[] {
  const gear = db.get('gear', gearId);
  const upgrade = gear.upgrades.find((u) => u.id === upgradeId);
  if (!upgrade) throw new ProgressionError('unknown upgrade');
  if (!ownsGear(draft, gearId)) throw new ProgressionError('not owned');
  if (draft.currentZone !== rules.gear.workshopZone || isNight(draft))
    throw new ProgressionError('workshop closed');
  const done = (draft.guardian.upgrades[gearId] ??= []);
  if (done.includes(upgradeId)) throw new ProgressionError('already done');
  if (!hasMaterials(draft, upgrade.materials)) throw new ProgressionError('missing materials');
  for (const m of upgrade.materials) takeItem(draft, db, m.item, m.qty);
  done.push(upgradeId);
  return [event('gear/upgraded', { gear: gearId, upgrade: upgradeId })];
}
