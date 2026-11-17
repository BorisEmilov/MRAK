/**
 * Passive modifiers (docs/systems/collection.md rules 2–4, progression.md A2, G2): permanent ones
 * (talents, abilities), cursed objects, cabinet sets, attributes, equipped gear and blessings.
 * Kept free of other core imports: `effectiveStat` depends on it.
 */
import type { CabinetSet, Effect, Modifier } from '@mrak/content-schema';
import type { ContentDatabase } from '../content/database';
import type { Snapshot, WorldState } from '../state/world-state';

type ReadState = Snapshot | WorldState;

/** Cursed object ids of the items displayed in the cabinet. */
export function displayedObjects(state: ReadState, db: ContentDatabase): string[] {
  return state.collection.cabinet.flatMap((item) => db.find('items', item)?.cursed ?? []);
}

/** Cabinet sets whose objects are all displayed. */
export function completeSets(state: ReadState, db: ContentDatabase): CabinetSet[] {
  const shown = new Set(displayedObjects(state, db));
  return db.all('cabinet-sets').filter((s) => s.objects.every((o) => shown.has(o)));
}

/** A modifier and where it comes from ("talent:exorcist/B2", "gear:knife", "blessing:knife/x"…). */
export interface SourcedModifier {
  source: string;
  modifier: Modifier;
}

function modifiersOf(effects: readonly Effect[]): Modifier[] {
  return effects.flatMap((e) => ('modifier' in e ? [e.modifier] : []));
}

/** Equipped gear ids: the lantern and every slot. */
export function equippedGear(state: ReadState): string[] {
  const out = state.light.lantern ? [state.light.lantern] : [];
  for (const id of Object.values(state.guardian.equipment)) if (id) out.push(id);
  return out;
}

/** Every active modifier with its source. */
export function modifierSources(state: ReadState, db: ContentDatabase): SourcedModifier[] {
  const out: SourcedModifier[] = state.modifiers.map((m) => ({
    source: m.source,
    modifier: m.modifier,
  }));
  const carried = new Set<string>();
  for (const s of state.guardian.pack) {
    const cursed = db.find('items', s.item)?.cursed;
    if (cursed && !carried.has(cursed)) {
      carried.add(cursed);
      for (const modifier of db.find('cursed-objects', cursed)?.carried ?? [])
        out.push({ source: `cursed:${cursed}`, modifier });
    }
  }
  for (const id of displayedObjects(state, db))
    for (const modifier of db.find('cursed-objects', id)?.displayed ?? [])
      out.push({ source: `cursed:${id}`, modifier });
  for (const set of completeSets(state, db))
    for (const modifier of set.modifiers) out.push({ source: `cabinet:${set.id}`, modifier });
  // Attributes above the base raise derived stats (progression.md A2).
  const rules = db.find('progression-rules', 'default');
  if (rules)
    for (const d of rules.attributes.derived) {
      const value = state.guardian.attributes[d.attribute];
      if (value === undefined || value === rules.attributes.base) continue;
      out.push({
        source: `attribute:${d.attribute}`,
        modifier: { statBonus: d.stat, value: d.per * (value - rules.attributes.base) },
      });
    }
  for (const gearId of equippedGear(state)) {
    const gear = db.find('gear', gearId);
    if (!gear) continue;
    for (const modifier of modifiersOf(gear.effects))
      out.push({ source: `gear:${gearId}`, modifier });
    for (const upgrade of state.guardian.upgrades[gearId] ?? []) {
      const def = gear.upgrades.find((u) => u.id === upgrade);
      for (const modifier of modifiersOf(def?.effects ?? []))
        out.push({ source: `upgrade:${gearId}/${upgrade}`, modifier });
    }
    for (const b of state.guardian.blessings[gearId] ?? []) {
      if (b.usesLeft === 0 || b.nightsLeft === 0) continue;
      for (const modifier of modifiersOf(db.find('blessings', b.blessing)?.effects ?? []))
        out.push({ source: `blessing:${gearId}/${b.blessing}`, modifier });
    }
  }
  return out;
}

/** Modifiers active now (see `modifierSources`). */
export function activeModifiers(state: ReadState, db: ContentDatabase): readonly Modifier[] {
  return modifierSources(state, db).map((m) => m.modifier);
}
