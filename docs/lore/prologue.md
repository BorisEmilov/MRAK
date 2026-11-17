# Prologue: Stana, 1779

Status: Draft v0.1 · MVP: ✅ · Back to [timeline](timeline.md) · [onboarding](../systems/onboarding.md)

The hook and the opening of the demo: the last three days of **Stana**, the herb-woman of Mrak,
before Enyovden 1779. The player never learns whether she was a witch (pillar 4). Target length
30–45 minutes.

## Setup

- Start `data/starts/default.json` → `prologue` (21 June 1779, 07:00); sets `prologue-active`,
  starts quest `prologue`. The village uses variant `year-1779` (`maps/village-1779.tmj`): no
  1834 villagers, no night director, no expeditions (core `PROLOGUE`). Stana sleeps through nights.
- Main menu "New Game" plays the prologue; "New Game (skip the prologue)" opens guardian creation.

## The three days (quest `prologue`, stories `ink/prologue-*.ink`)

| Day | Scenes (POI → story)                                                                                                             | Tutorial hints (`hints/tutorial.json`)                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Daily life: tend Kalina, sew the doll (`stana-house`); basil (`basil-pots`) for Marija (`marija-gate`)                           | move, interact, talk, inventory, journal, map, glossary |
| 1→2 | Dusk: light the lamp, go home, sleep. Wake with forest mud (`prologue-woke-forest`)                                              | lamp, sleep, save, HUD                                  |
| 2   | Suspicion: dying cattle and the knot under the manger (`byre`); Dragan at the crossroads, the coin (`crossroads-stone`)          | —                                                       |
| 3   | Accusation (`church-porch`), the elders' "not a court" (`elders-oak`), the pyre and Kalina given to Ivan Svetlev (`forest-edge`) | —                                                       |

Every scene can be read as guilt or as a frame: the doll is warm, the cow dies under her hand, the
knot is hers, she walked to the forest asleep.

## Seeded clues (paid off tens of hours later)

- The **key with three teeth** on Dragan's coin = the cipher of his Pact ledger in the church altar
  table ([zlatno-bloodline](zlatno-bloodline.md)); the priest looks at the altar when Dragan is named.
- "A man from Zlatno asked which house was the herb-woman's" (Marija, day 1).
- The knot under the manger is bound "the way only Stana does it" — someone watched her.
- The doll goes with Kalina; it becomes the cursed **rag doll** of 1834.

## Transition to 1834

The last scene sets `prologue-complete` with the doll in Kalina's arms. When the dialogue closes,
the host returns to guardian creation (Christmas 1834). The same doll is found on the nameless
grave (`old-grave`) — Stana's.

## Memories (cursed objects, [collection](../systems/collection.md) rule 5)

Recalling a cursed object in 1834+ shows what Stana did not see:

| Object             | Prologue scene | What was not seen                                           |
| ------------------ | -------------- | ----------------------------------------------------------- |
| `zlatno-gold-coin` | Crossroads     | Dragan's blood oath; the voice names the herb-woman first.  |
| `samodiva-pendant` | Night 1 (mud)  | The samodivi kept her in the forest; a lantern in the byre. |
| `rag-doll`         | Pyre           | Mara Svetleva lifts the unburnt doll from the ash.          |
