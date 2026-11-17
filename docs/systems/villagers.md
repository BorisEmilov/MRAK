# Villagers

Status: v1 · MVP: ✅ (8 villagers) · Package: `packages/core/src/village` · Back to [GDD](../GDD.md) · [index](README.md) · cast: [villagers-mvp](../lore/villagers-mvp.md) · work: [tasks](tasks.md)

## Purpose

Named villagers with fears, relationships and secrets who live on whether or not the guardian
is present. They are the village's labour, its witnesses and its weakest point (fear spreads).

## Data

| Field                           | Type                                | Notes                                             |
| ------------------------------- | ----------------------------------- | ------------------------------------------------- |
| `id`, `nameKey`, `age`, `trade` | —                                   | Content.                                          |
| `fear`                          | 0–100                               | Personal fear.                                    |
| `health`                        | 0–100 + conditions                  | sick, injured, possessed (hidden).                |
| `affinity`                      | map villagerId/guardian → −100..100 | Relationship graph.                               |
| `fears[]`                       | tags                                | e.g. `water`, `fire`, `aga`, `dark`.              |
| `secrets[]`                     | ids                                 | Revealed via dialogue, confession, investigation. |
| `schedule`                      | content                             | Day / night locations.                            |
| `suspicion`                     | 0–100                               | How much the village suspects them (hysteria).    |
| `alive`, `status`               | —                                   | exiled, dead, missing, married…                   |

## Rules

1. **Schedules:** villagers move between home, work and gathering points by phase; at night most
   are home unless on a task (watch, vigil) or sleepwalking.
2. **Fear contagion:** each in-world hour, fear flows along relationships (see formula).
3. **Triggers:** fear rises from events touching their `fears` tags, nearby deaths, sightings, and
   the guardian's own visible fear (a guardian with Sanity < 30 spreads fear).
4. **Breaking points:** fear ≥ 80 → refuses night tasks, can be possessed by lesser besove;
   fear 100 → panic event (flee, hide, accuse).
5. **Secrets** are content-defined with reveal conditions (affinity, clue, confession, possession stage).
6. **Death is permanent.** New villagers arrive only through [village-growth](village-growth.md).

## Initial formulas

- Contagion per hour for villager _v_:
  `Δfear_v = Σ_u (w_uv × max(0, fear_u − fear_v) × 0.02)`, with `w_uv = max(0, affinity_uv)/100`;
  capped at +5/hour.
- Natural decay by day: −5 (−10 if a chapel service happened, −3 if Hysteria > 60).
- Fear event magnitudes: sighting +10, death of close relation +25, attack on village +15, matching fear tag ×1.5.

## Events

- **Emits:** `villager/fearChanged`, `villager/panicked`, `villager/secretRevealed`,
  `villager/died`, `villager/affinityChanged`, `villager/sleepwalking`.
- **Consumes:** `director/eventFired`, `possession/stageAdvanced`, `hysteria/accusationMade`,
  `task/completed`, `time/*`.

## Edge cases

- Affinity cycles (A likes B likes A) must not amplify fear above the per-hour cap.
- A possessed villager's fear may be _faked_ by the demon (displayed value ≠ true value).
- Removing a villager (death) must clean relationship edges and task assignments.

## Test ideas

- Two villagers, affinity 100, fear 80 and 0: after 1 hour, receiver gains exactly the capped value.
- Negative affinity transmits no fear.
- Fear ≥ 80 villager cannot be assigned to `task.watch` (command rejected with reason).
- Death removes the villager from all affinity maps and tasks.
- Possessed villager: UI snapshot shows masked fear; core keeps true fear.

## Implementation (v1)

The village is simulated by core **whether or not the guardian is there**, in whole in-world
hours, so the result never depends on frame rate, tick size or the zone the guardian is in.
Phaser only _draws_ where each villager is (a pure function of state and time); React only
_shows_ masked views and sends commands.

### Data

| File                              | Collection (kind)       | What                                                                             |
| --------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `data/villagers/<id>.json`        | `villagers` (villager)  | + `home`, `work` (POI ids of the village zone), `routine`, `look` (colours, hat) |
| `data/traits/traits.json`         | `traits` (trait)        | Task efficiency multipliers, fear gain, spread, need rates                       |
| `data/tasks/tasks.json`           | `tasks` (task)          | Day/night work ([tasks](tasks.md))                                               |
| `data/routines/*.json`            | `routines` (routine)    | Time blocks (`at`, `activity`, `place`) and overrides (`when`, `days`, priority) |
| `data/village-rules/default.json` | `village-rules` (rules) | Every number of this spec (contagion, needs, death) — tuned without code         |

Villager-scoped stats (registry): `fear`, `hunger`, `cold`, `villager-faith`, `health` (0–100).
Village stat `night-watch` (defence of tonight's watch). The **stores** of the village are the
shared inventory (`guardian.inventory`): bread, firewood, garlic, oil…

State per villager (`WorldState.villagers[id]`): `alive`, `affinity`, `status`
(`healthy` `sick` `terrified` `dead` `returned`), `tasks {day, night}`, `progress {day, night}`
(effective minutes), `pending` (finished day batches not yet delivered), `stalled`, `panicked`,
`secrets` (revealed ids), `death { day, minute, cause, burial: pending|proper|improper }`.
Village: `village { heated: homeIds[], portions }`. **Possession is not a status**: it lives in
`possessions[]` and is masked (rule 12).

### Rules

1. **Routines.** A routine is a list of blocks `{ at: "HH:MM", activity, place }`; the block in
   force is the last one whose `at` ≤ now (wrapping past midnight). Activities: `sleep` `eat`
   `work` `pray` `socialize` `chores` `rest` `wander`. Places: `home`, `work` (the villager's
   trade place) or any village POI id.
2. **Routine choice.** Each villager has a base `routine`. Routines with `priority > 0` override
   it for the villagers they list (all if omitted) on the weekdays in `days` (0 = Sunday) while
   `when` holds (festivals via `{ "chapter": … }`, events via flags/stats). Highest priority wins,
   then id order. MVP: `sunday` (liturgy), `unclean-days` (home before dusk), `curfew`
   (hysteria ≥ 60) and `tavern-closed` (flag).
3. **Status overrides** (after the routine, in order): dead → absent; returned → at night it
   walks the village from its grave, by day it lies in it; sick → `rest` at home all day; a night
   task during the night phase → its place; `work` with a day task → `task` at the task's place;
   terrified → no `socialize`/`chores`/`wander` (home instead), `sleep` becomes `hide`; a hidden
   possession avoids `pray` (→ `wander` at the cemetery) and sleepwalks to the well 02:00–03:00.
4. **Hourly step** (each whole hour crossed, villagers in id order, from the state at the start
   of the hour): needs, contagion, health, status, task progress, secrets. Phase checkpoints
   (dusk, night, dawn) run after the hour step of the same minute.
5. **Needs.** _Hunger_ +3/h; the first quarter-hour of an `eat` block eats one portion (a `bread`
   = 4 portions) for −45 hunger; none left → `village/mealShort`. _Cold_: by day −4/h; at dusk and
   night outdoors + season rate (winter 6, autumn 3, spring 2, summer 0), at home with a fire
   −6/h, at home without +½ season rate × (1.5 − repair/200). At dusk every occupied home lights a fire with 1 `firewood`
   (homes in id order); homes left without are cold (`village/coldNight`). _Faith_ −2/day, +6/h
   praying, + the task's `faith`/h while working (ritual preparation 2). _Health_ −3/h for each need ≥ 90, +0.5/h when both < 70.
6. **Fear sources.** +1/h while hunger or cold ≥ 70; `dark` fear +1/h outdoors at night;
   `solitude` fear +1/h alone at night; death of a close relation (affinity ≥ 50) +25, of anyone
   else +5; each returned dead walking +10 at nightfall. A matching fear tag multiplies by 1.5.
   Every gain × trait `fearGain` × `(1 − faith/100 × 0.5)`.
7. **Contagion** (hourly, simultaneous from the start-of-hour fears): see formulas. The weight
   is how much the receiver cares for the sender, plus a proximity weight when both spent the
   hour at the same place — strangers at the tavern share fear too.
8. **Decay** at dawn: −5 fear (−3 instead when hysteria > 60).
9. **Status** with hysteresis: `sick` below 50 health until ≥ 75; `terrified` at fear ≥ 80 until
   < 60; `panicked` event at 100 (once until it drops below 80). Death at health 0 (`cold` or
   `hunger`), or by the `killVillager` effect (director events, rites gone wrong).
10. **Death and burial.** Death empties the villager's tasks and removes every affinity edge to
    and from them. At the first dawn after a death the sexton (trait `sexton`) and the priest
    (trait `priest`) bury them **properly** if both live, are not sick, the sexton is not
    terrified and the cause is not unquiet (`violence`, `drowning`, `suicide`); otherwise the
    burial is **improper**. By day the guardian can bury them properly with `buryVillager`
    (takes 1 `incense`).
11. **Return.** At nightfall, the dead with an improper burial since ≥ 1 night **return**
    (`villager/returned`): a _vampir_ with their name and face walks the village every night.
    Touching the guardian costs 8 Sanity (`encounterReturned`). By day `buryVillager` on a
    returned villager lays them to rest with 2 `garlic` (hawthorn stake in the full game).
12. **Masking.** UI views never show a hidden possession: shown status ignores it, shown fear is
    `true fear × 0.3` (the demon fakes calm), `terrified` is judged on the shown fear. Core keeps
    the true values.
13. **Secrets.** Each hour, unrevealed secrets whose `revealWhen` holds are revealed
    (`villager/secretRevealed`).

### Formulas (numbers in `village-rules`)

- Contagion: `Δfear_v = min(5, Σ_u w_uv × max(0, fear_u − fear_v) × 0.02 × spread_u) × gain_v`,
  `w_uv = max(0, affinity_v→u (or u→v if v has none))/100 + 0.25 × [same place this hour]`,
  `gain_v = fearGain_v × (1 − faith_v/100 × 0.5)`. Affinity ≤ 0 alone transmits nothing.
- Efficiency: see [tasks](tasks.md).

### Events

`villager/statusChanged {villager, from, to}`, `villager/panicked`, `villager/died {cause}`,
`villager/buried {proper}`, `villager/returned`, `villager/laidToRest`,
`villager/returnedAttacked {sanity}`, `villager/secretRevealed {secret}`,
`village/mealShort {villagers}`, `village/coldNight {homes}`, plus the task events.
Hourly need/fear changes are not events (the UI reads snapshots).

### Presentation

- **Phaser (village zone only):** one NPC per villager present; every 250 ms the scene asks core
  where each one should be and walks them there along an A\* path (8 directions, no corner
  cutting) over the collision layer and closed paths. Animation by activity/status (walk, work,
  idle, tremble when afraid, slump when sick); a bubble shows the most pressing state icon
  (fear, hunger, cold, sickness, current task). At night the returned walk from the cemetery
  towards a noisy guardian and keep away from a lit lantern. Sprites and portraits are drawn
  from the villager's `look`, so the returned keep their face.
- **React:** village panel (V / RT): villager cards (portrait, needs, status, current activity,
  day and night task slots — drag a task onto a slot, or pick it from the slot's menu with
  keyboard/gamepad), filters, and a relationship graph (bonds and grudges) with a text list.

### Tests (v1)

Contagion (capped, grudges transmit nothing, cycles stay under the cap, proximity), routines of
the 8 villagers over a full day, festival/Sunday overrides, deliveries at dusk, refusal of night
tasks at fear ≥ 80, death cleanup, improper burial → return → lay to rest, masking, and
**off-screen determinism**: ticking second by second, skipping time in one step, and spending the
day in the forest produce the same village.
