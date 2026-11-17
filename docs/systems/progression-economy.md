# Progression economy (master plan)

Status: Draft v0.1 · **source of truth for all progression numbers**. If another spec disagrees
with this file, this file wins and the other spec must be fixed.
Back to [GDD](../GDD.md) · related: [revelation-xp](revelation-xp.md), [talents](talents.md),
[attributes](attributes.md), [skills](skills.md), [village-growth](village-growth.md),
[bloodline-tree](bloodline-tree.md), [endless-chronicle](endless-chronicle.md).

## 1. Design goals

1. Something to work toward **every session** (guardian, village, bloodline).
2. **No progression for killing.** Revelation only from understanding and surviving.
3. **No infinite power creep.** Power per guardian is bounded; long-term growth is
   **horizontal** (more options, more knowledge, more stories), plus bounded account bonuses.
4. **Death is a transition, not a reset**: talents are lost, the bloodline and village are not.
5. **Never sold.** No currency or progression is purchasable ([business](../business/README.md)).

## 2. Time model used for pacing

| Unit                 | Real time (target) | Notes                                                              |
| -------------------- | ------------------ | ------------------------------------------------------------------ |
| Night                | 12–15 min          | Exploration until dawn.                                            |
| Day                  | 6–10 min           | Management, dialogue, deduction board.                             |
| Chapter (festival)   | 1.5–2.5 h          | 5–12 nights.                                                       |
| Played year          | 9–12 h             | 6 chapters. Between years: a **time-skip** of 1–10 in-world years. |
| Generation           | 10–20 h            | 1–2 played years per guardian on average.                          |
| Route                | 30–40 h            | ~3 generations, 1834 → 1878.                                       |
| MVP (vertical slice) | 6–8 h              | 1 chapter (12 nights), 1 generation.                               |

## 3. Revelation (XP) sources

| Milestone                                             | Revelation   | Frequency (approx.) |
| ----------------------------------------------------- | ------------ | ------------------- |
| Night survived                                        | 2            | every night         |
| Night objective completed                             | 5            | most nights         |
| First visit to a zone (or zone variant)               | 5            | ~1 per chapter      |
| Clue chain completed (proposition fully supported)    | 3            | 3–6 per mystery     |
| Truth discovered (journal "Truth" entry)              | 10           | 1–3 per chapter     |
| Villager personal arc resolved                        | 10           | 1–2 per chapter     |
| Exorcism — lesser bes / named demon / prince          | 8 / 20 / 40  | 1–3 per chapter     |
| Mystery concluded correctly — minor / chapter / major | 15 / 30 / 50 | 1 per chapter       |
| Mystery concluded **wrongly** ("a lesson")            | 10           | —                   |
| Chapter (festival) survived                           | 25           | 6 per year          |
| Route milestone                                       | 40           | ~6 per route        |
| Killing a creature                                    | **0**        | never               |

**Expected rate:** ~25–30 Revelation per hour of play, rising slowly to ~35/h late in a route
(bigger milestones). MVP total ≈ **220–260**.

## 4. Spending (costs)

| Purchase                          | Cost                                           |
| --------------------------------- | ---------------------------------------------- |
| Talent T1 / T2 / T3 / T4          | 5 / 10 / 15 / 20                               |
| Full tree (12 talents)            | 150                                            |
| Second tree of own calling        | 20 (access)                                    |
| Tree of another calling           | 30 (access) + 5 per talent                     |
| Dark tree access                  | free (requires pact) — talents add Corruption  |
| Attribute +1                      | 10 × new rating (2→3 = 30, 3→4 = 40, 4→5 = 50) |
| Skill rank cap +1 (calling skill) | 5 × new cap                                    |
| Skill rank cap +1 (other skill)   | 5 × new cap + 5                                |

Skill **ranks** themselves rise only by use (see [skills](skills.md)); Revelation raises the
**cap**. This keeps both growth modes meaningful.

A single guardian's lifetime Revelation (≈ 300–600) cannot buy everything:
2 full trees (320 with access) + 2 attributes to 4 (140) + several caps already exceeds 500.
**Every guardian is a build.**

## 5. Expected guardian power

**Power index** (for balancing only, not shown to players):
`P = Σ attributes + Σ skill ranks + 0.5 × talents owned + Bloodline bonus points`.

| Played hours | Typical state                                                                           | Revelation earned by the current guardian | P (current guardian)        |
| ------------ | --------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------- |
| 1            | Prologue done, night 1–2. 1–2 T1 talents. Skills rank ≤ 1.                              | ~20                                       | ≈ 19                        |
| 5            | Mid-MVP. First tree T1–T2 mostly bought, 1 attribute raised, 2 skills at rank 2.        | ~130                                      | ≈ 26                        |
| 8 (MVP end)  | Tree 1 nearly complete or 2 trees started. Several skills rank 2–3.                     | ~240                                      | ≈ 32                        |
| 20           | Usually 2nd guardian (≈ 5 h in). Starts stronger via Bloodline T1–T2 and journal.       | ~140 (+ inherited bonuses)                | ≈ 30                        |
| 50           | 3rd–4th guardian; route ending; bloodline T3. Specialized builds, 1 dark tree possible. | ~350                                      | ≈ 42                        |
| 100+         | Endless Chronicle, Darkness 3–5. Bloodline T4–T5 choices.                               | ~400–600 per guardian                     | ≈ 45–50 (hard ceiling ≈ 55) |

Ceilings: attributes 5 (6 with one heirloom/talent), skill ranks 5, Fate dice per check ≤ 8.
**Long-term power grows by < 15% after hour 50**; difficulty and options grow instead.

## 6. Village pacing

| Prosperity level | Unlocks                                                     | Typical hour  |
| ---------------- | ----------------------------------------------------------- | ------------- |
| 1 — Cursed       | Chapel (lvl 1), herbalist's hut, watchtower (MVP buildings) | 0             |
| 2 — Enduring     | Building lvl 2, a travelling trader, 1 new villager family  | 6–8 (MVP end) |
| 3 — Recovering   | School, workshop, monastery restoration                     | 15–25         |
| 4 — Hopeful      | Building lvl 3, festivals with visitors, Zlatno trade       | 30–45         |
| 5 — Proud        | Chitalishte (after 1856), unique endings variants           | 60+           |

Prosperity can **fall** (curses, wrong accusations, debt collections). Expect 1–2 level drops per route.

## 7. Bloodline Tree pacing

**Legacy** is earned when a generation ends (death or retirement):
`Legacy = floor(lifetimeRevelation / 25) + 5 × chaptersSurvived + 2 × newAchievements + journalTruths`.

| Tier     | Nodes                             | Cost per node | Cumulative Legacy to complete | Reached around        |
| -------- | --------------------------------- | ------------- | ----------------------------- | --------------------- |
| T1 (MVP) | 6                                 | 5–8           | 37                            | first 1–3 generations |
| T2       | 6                                 | 12            | 109                           | hour 25–40            |
| T3       | 5                                 | 18            | 199                           | hour 50–70            |
| T4       | 4                                 | 25            | 299                           | hour 90–120           |
| T5       | 3 pairs (choose one of each pair) | 40            | 419                           | hour 150+             |

MVP generation yields ≈ 18–26 Legacy → 3–4 T1 nodes.

## 8. Endless Chronicle — growth without power creep

1. **Soft caps:** after a guardian's lifetime Revelation passes 600, talent costs rise +25%
   (they can still finish a tree, slowly).
2. **Ageing:** guardians age between chapters; after 55, −1 Vigor/Agility each 5 years — renewal
   through heirs is natural, not forced.
3. **Darkness levels 1–10:** each level +10% creature strength, +5% debt-collection chance, +1
   Shadow die on rituals at levels 3/6/9; rewards Legacy × (1 + 0.1 × level).
4. **Horizontal rewards:** rare **Relic talents** (unlocked at Darkness 3/5/7/10) replace a
   talent of a tree with an alternative — never stack on top.
5. **Content variety:** procedural mysteries, possessions and festival variants; new seasonal packs.
6. **Bloodline T5** is mutually exclusive choices: identity, not raw power.

## 9. Test ideas

- Simulation test in `packages/core`: run 1,000 seeded MVP playthroughs with a scripted policy;
  assert Revelation total in [200, 280] for the 10th–90th percentiles.
- Assert no code path awards Revelation from a `combat/creatureKilled` event.
- Assert P never exceeds 55 under any purchasable combination (property-based test).
- Assert Legacy formula yields 18–26 for the MVP reference run.

## 10. Simulator bands

The core simulator ([progression §12](progression.md#12-simulator-balance)) must keep every
profile (cautious, dark, investigator; 20 seeds each, median) inside these bands. They are the
plan's §3 and §5 numbers with a ±25% tolerance; rows after hour 8 depend on the Bloodline Tree
(not simulated in v1) and are reported but not enforced.

| Played hour | Lifetime Revelation | Power index P | Debt (dark profile) | Debt (others) |
| ----------- | ------------------- | ------------- | ------------------- | ------------- |
| 1           | 15–40               | 17–22         | 0–20                | 0             |
| 5           | 100–170             | 22–30         | 10–60               | 0–10          |
| 8 (MVP end) | 190–300             | 27–37         | 15–80               | 0–10          |

Pacing assumption of the MVP: a night-and-day cycle takes ~35 minutes of play (12 nights in
6–8 hours, §2), so per-night milestone frequencies are the §3 frequencies spread over a
12-night chapter.
