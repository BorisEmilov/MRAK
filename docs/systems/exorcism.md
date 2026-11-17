# Exorcism

Status: Draft v0.1 · MVP: ✅ · Package: `packages/core/occult/exorcism` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

A **phased ritual**, not a button. Preparation (knowledge, seal, place, allies) matters more than
dice. Failure has consequences: the demon jumps to another host — or to you.

## Data

`exorcismAttempt`: `{ possessionId, location, participants[], preparedItems[], phase, results[] }`.

## Rules

Four phases, each a check ([omens](omens.md)); the attempt can be **abandoned** between phases (with a cost).

| Phase           | Check                                                                                        | Requirements                                     | Helps                                                    |
| --------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| 1. **Identify** | Occultism or Lore vs demon rank                                                              | Symptoms observed (≥ 2)                          | Journal entries on the demon                             |
| 2. **Bind**     | Occultism (Average + rank)                                                                   | **True name** + **seal** (drawn with its medium) | Engraved seal gear, Binding Word (no seal at +2S)        |
| 3. **Confront** | Exorcism (Hard) — a dialogue duel; the demon uses the host's secrets and the guardian's sins | Phase 2 success                                  | Litany, family present, weaknesses used (+1F each)       |
| 4. **Cast out** | Exorcism or Liturgy (Hard + rank)                                                            | Phase 3 success                                  | Holy water, chapel location (+1F), Theophany water (+2F) |

1. **Success** of all four → possession ends; host Fear −30; Revelation by rank.
2. **Failure at Bind or later** → the demon **jumps**: to the most frightened villager present or
   nearby, or **to the guardian** on a bad omen (unless Unbroken).
3. **Bad omens on success** leave scars: a symptom persists, Notice +10, or the demon learns the
   guardian's name (future attempts +1S).
4. Lesser besove: only phases 1 and 4.
5. Exorcism in public lowers Hysteria on success, raises it on failure.
6. The church's stance: Pop Stoyan must consent for rites in the church (affinity ≥ 20), else
   rites happen at home (no chapel bonus).

## Implementation (v1)

Code: `packages/core/src/occult/exorcism.ts`; numbers in `data/fear-rules` → `exorcism`; UI
`apps/game/src/ui/character/ExorcismPanel.tsx` (started from the talk dialog). Phases follow the
v1 design (supersedes the table above until the full four checks land):

1. **Preparation** (`prepareExorcism`): items from the pack are consumed onto the altar (max
   `maxItems`). A holy item, the salt circle and a demon weakness each lower the check one step.
2. **Confrontation** (`confrontDemon`): the demon taunts with real facts from the WorldState
   (pacts signed, sacrifices recorded by `sanity-shock {cause: sacrifice}`, the lynched, the dead,
   debts), up to `maxTaunts`, each costing Sanity; then a check (difficulty + rank − 1 −
   preparation). No possession in the host ⇒ `exorcism/empty`.
3. **Naming** (`speakName`): only composed true names can be spoken; the wrong one fails.
   `bind: true` ends the possession with the `bindDebt` debt (the guardian owes the demon).
4. **Expulsion** (`expel press|hold`): progress vs the demon's push (rank × `pushPerRank` ×
   0.5–1.5) within `rounds`, paid in Sanity; under `breakBelow` the rite fails.

**Failure** (or abandoning): Sanity loss, and the demon jumps to the most frightened villager —
or to the guardian (`guardianJumpChance`, or if no one else is left).

## Initial formulas

- Shadow dice by rank: +rank in every phase (rank 2 ⇒ +2S).
- Abandon cost: host stage +1, Sanity −10.

## Events

- **Emits:** `exorcism/started`, `exorcism/phaseResolved { phase, success, omen }`,
  `exorcism/succeeded`, `exorcism/failed`, `exorcism/demonJumped { toId }`, `exorcism/nameLearned`.
- **Consumes:** `possession/*`, `journal/*`, `check/resolved`.

## Edge cases

- Wrong demon identified in phase 1 (failure + good omen = "a name, but not the right one") →
  Bind with the wrong name automatically fails, revealing the error.
- Host dies during the rite (stage 5 night) → rite ends; jump rules apply.
- The guardian is the host → another character must perform it (NPC priest, heir) — or the forest spirit, at a price.

## Test ideas

- Bind without seal or name is rejected unless Binding Word.
- Failure at Confront with a bad omen and no Unbroken ⇒ jump target is the guardian.
- Theophany water adds exactly +2F in phase 4.
- Successful exorcism of a rank-2 demon awards the 20-Revelation milestone once.
