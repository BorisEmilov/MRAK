# Hysteria & witch hunts

Status: Draft v0.1 · MVP: ✅ · Package: `packages/core/village/hysteria` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Fear becomes a crowd. Rumours turn into accusations, accusations into mobs. The player can calm
it, steer it — or be its target. Hanging an innocent **feeds the evil** (Lazhets, the Horned One,
Corruption). This mirrors the 1779 crime at the heart of the story.

## Data

`village.hysteria` 0–100; `villager.suspicion` 0–100 (also `guardian.suspicion`);
`rumours[]`: `{ id, targetId, claim, source, strength }`; `mob`: `{ targetId, size, stage }`.

## Rules

1. **Gain:** unexplained deaths, possession symptoms seen, fires, Lazhets' influence, low village
   sanity, a missing guardian at dawn, failed public rituals.
2. **Loss:** solved mysteries (−20), successful public exorcism (−15), chapel services, festivals
   observed, Leadership/Persuasion checks, Peacemaker talent.
3. **Stages:** < 40 calm · 40–59 **rumours** (suspicion rises on the "odd" — widows, herb-women,
   outsiders, the guardian) · 60–79 **accusations** (a villager is publicly named daily) · ≥ 80 **mob**.
4. A **mob** forms around the most suspected person. The guardian may intervene (Leadership,
   Persuasion, Intimidation, or presenting a valid clue); otherwise the mob acts at dawn:
   exile, beating, or killing (burning/hanging).
5. Mob killings are **crimes under Ottoman law**: the aga's inquiry follows (fines, arrests,
   reputation with the aga −30). The village's Corruption rises, the evil powers gain strength.
6. **The guardian can be accused** (suspicion ≥ 70 at an accusation stage). Being the mob's
   target forces a set-piece: flee, persuade, or prove innocence.
7. Mystery conclusions also feed the hysteria system: the village acts on the guardian's word.

## Initial formulas

- Suspicion gain per rumour: `strength × traitMultiplier` (herb-woman ×1.5, outsider ×1.3, widow ×1.2,
  Znaharka guardian ×1.5).
- Hysteria natural decay per day: −3 if no new incidents.
- Mob intervention difficulty: Average + 1 per 10 Hysteria above 80, −1 with a valid clue.

## Implementation (v1)

Code: `packages/core/src/fear/hysteria.ts`. Numbers: `data/fear-rules/default.json` → `hysteria`.
State: `WorldState.hysteria { mob, accusations[], trials[], incidentDay }`; suspicion is the
villager stat `suspicion` and the guardian stat `guardian-suspicion`.

1. **Gains** go through `addHysteria` (× `hysteria-gain-rate`, × `lowVillageSanity.factor` when
   village sanity is below `lowVillageSanity.below`). Incidents: a villager death, a lynching, the
   guardian missing at dawn. Any rise of `hysteria` marks the day as an incident day.
2. **Dawn** (after the village simulation): natural decay if no incident since the last dawn;
   then by stage — _rumours_: one rumour against a living villager or the guardian, picked by
   trait weight; _accusations_: the most suspected is named publicly; _mob_: a mob forms around
   the most suspected (the guardian qualifies only at suspicion ≥ `guardianAccusableAt`).
   A mob formed on a previous dawn holds its **improvised trial**: verdict by hysteria —
   `lynched` (≥ `mob.lynchAt`), `beaten` (≥ `mob.beatAt`) or `spared`. The guardian is never
   killed: as the target they are beaten (`guardianBeatenEffects`).
3. **Confronting the mob** (`confrontMob` command, once per mob, guardian in the village zone):
   - `calm` — check (`mob.skill`, context `hysteria-calming`); success disperses the mob.
   - `steer { target }` — check; success moves the mob to another villager. The guardian is then
     complicit in what the mob does.
   - `exploit` — no check: the trial happens now, the guardian's suspicion drops, the guardian is
     complicit and pays `exploitEffects` (Corruption).
     Difficulty: `mob.difficulty` + 1 step per 10 hysteria above 80, − 1 step if the guardian holds
     a clue that refutes `culprit:<target>`. Failure raises the guardian's suspicion.
4. **Lynching**: `killVillager` with cause `lynching.cause`; emits `hysteria/lynching`. An innocent
   victim (not a possession host) applies `lynching.innocentEffects` — **village Corruption
   rises** and the dead may return; complicit guardians also pay `complicitEffects`. A possessed
   victim releases the demon into another living villager (hidden possession).

## Events

- **Emits:** `hysteria/changed`, `hysteria/rumourSpread`, `hysteria/accusationMade`,
  `hysteria/mobFormed`, `hysteria/mobDispersed`, `hysteria/trialHeld { target, verdict }`,
  `hysteria/lynching { victim, innocent }`.
- **Consumes:** `villager/died`, `possession/symptomSeen`, `mystery/concluded`, `director/eventFired`,
  `time/dawn`.

## Edge cases

- Mob target is the actually possessed villager → killing them releases the demon to a new host
  (not a "win").
- The mob's target dies before dawn (other cause) → mob disperses, hysteria −10, suspicion
  transfers to the nearest relation.

## Test ideas

- Stage transitions at exactly 40/60/80.
- A lynching of an innocent emits `innocent: true`, adds the configured Corruption, and triggers the aga inquiry quest.
- Presenting a valid clue reduces intervention difficulty by one step.
- Guardian suspicion ≥ 70 at stage ≥ 60 can produce `accusationMade` targeting the guardian.
