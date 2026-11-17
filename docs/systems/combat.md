# Combat

Status: Draft v0.1 · MVP: ✅ (basic) · Package: `packages/core/combat` + Phaser · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Real-time, top-down, **desperate** combat (in the spirit of action-management games, but slower and
heavier). The guardian is not a warrior: fighting is costly and usually a way to escape, protect
or buy time. **Killing gives no Revelation.**

## Data

- Guardian: health, stamina, weapon (damage tier, reach, speed), light.
- Creature content: `{ id, health, damageResistanceTier, speed, behaviour, weaknesses[], fears[] (light, iron…), dropTable }`.

## Rules

1. **Actions:** move, dodge (stamina), strike (stamina), **light burst** (oil), use item (holy water,
   salt, garlic), shove off (karakondzhul riding).
2. **Damage tiers:** effective damage = weapon tier − creature resistance tier (min 0 ⇒ only stagger).
   Blessings raise tiers vs the relevant creature type.
3. **Weaknesses** from folklore work exactly (garlic repels vampires, rooster crow ends
   karakondzhuli, hawthorn kills vampires).
4. **Light burst** stuns and pushes creatures in radius; costs 1 oil; demons need consecrated oil.
5. Demons are not fought with weapons — possession is handled by [exorcism](exorcism.md).
6. **Injury at 0 health:** _Last Breath_ check (Resolve + Composure, Hard). Success: wake at dawn
   injured (an injury lasting 3 days). Failure: **death** → [lineage](lineage.md).
7. Key manoeuvres use [omens](omens.md) checks (e.g. a desperate shot): good omen ⇒ creature
   flees and leaves a trail.

## Initial formulas

- Strike stamina 20, dodge 25, regen 15/s. Base damage per tier: 10.
- Last Breath difficulty: Hard; +1 Shadow per injury already active.

## Events

- **Emits:** `combat/started`, `combat/hit`, `combat/creatureRepelled`, `combat/creatureKilled`
  (no Revelation listeners allowed), `combat/guardianDowned`, `combat/lastBreath { success }`.
- **Consumes:** `gear/*`, `light/*`, `director/eventFired` (spawns).

## Edge cases

- Fighting near villagers: friendly fire impossible, but villagers witnessing violence gain fear.
- Possessed villager attacking → cannot be damaged below 1 health; must be restrained.

## Test ideas

- Damage tier math: tier 2 vs resistance 3 ⇒ 0 damage, stagger only.
- Garlic in hand ⇒ vampire AI cannot enter melee range.
- Static rule test: no milestone or listener grants Revelation on `combat/creatureKilled`.
- Last Breath success/failure branches produce injury vs death events.
