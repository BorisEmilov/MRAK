# Time & Calendar

Status: Draft v0.1 · MVP: ✅ (Unclean Days only) · Package: `packages/core/time` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

Drives days, nights, chapters (festivals), years and time-skips. Uses the **Julian calendar**
in-world ([timeline](../lore/timeline.md#calendar-note)).

## Data

| Field                     | Type                                 | Notes                                                          |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| `year`, `dayOfYear`       | int                                  | Julian; 1834 start.                                            |
| `minute`                  | 0–1439                               | In-world minute of day.                                        |
| `phase`                   | `dawn` \| `day` \| `dusk` \| `night` | Derived from minute + season.                                  |
| `chapterId`, `nightIndex` | id, int                              | E.g. `chapter.unclean-days`, night 1–12.                       |
| `paused`                  | bool                                 | Day management is paused while menus are open; nights are not. |

Content: `chapters/*.json` — dates, number of nights, night length multiplier, special nights.

## Rules

1. **Day** is turn-like: time advances when the player performs actions (talk 15 min, task
   assignment free, ritual 60 min…). The day ends when the player chooses **"Go out at dusk"**.
2. **Night** runs in real time: 1 in-world minute = 1 real second (× chapter multiplier).
3. Special minutes: **00:00** (midnight — pacts possible), **03:33** (witching minute — director
   priority window), **first cock-crow** (~04:30 winter) ends karakondzhul activity.
4. **Dawn** ends the night. If the guardian is outside the village at dawn: **dawn penalty**.
5. A chapter ends after its last night (or on its scripted dawn); then the next chapter, or the
   **year end** with an optional time-skip (1–10 years, player choice within the story's limits).
6. Historical anchors (1839, 1856, 1870, 1876) are applied when a time-skip crosses them.

## Initial formulas

- Night length (minutes): winter 20:00 → 06:30, summer 22:00 → 04:30; × chapter multiplier
  (Unclean Days 1.2).
- Dawn penalty: Sanity −15, one random carried item lost (30%), and the village applies "the guardian
  was missing" (Hysteria +5).
- Ageing: everyone ages by the skipped years; see [lineage](lineage.md).

## Events

- **Emits:** `time/dayStarted`, `time/duskReached`, `time/nightStarted`, `time/midnight`,
  `time/witchingMinute`, `time/cockCrow`, `time/dawn`, `time/chapterStarted`, `time/chapterEnded`,
  `time/yearSkipped { years }`, `time/historicalAnchor { id }`.
- **Consumes:** `ui/goOutAtDusk`, `action/performed { minutes }`.

## Edge cases

- Player idles in a day menu for hours → no time passes (pillar: UI friendly).
- Browser tab hidden at night → the simulation pauses (Phaser loop stops); on return a "you
  stood still in the dark" message, no catch-up simulation beyond 60 s.
- Movable feasts (Pentecost, Cheesefare Sunday) computed from Julian Easter (Orthodox computus).

## Implementation (core v1)

- Julian ↔ JDN and Gregorian ↔ JDN conversions; Orthodox Easter by Meeus' Julian algorithm
  (checked against 2024 and 2025); movable feasts = Easter + `easterOffsetDays`.
- Light by month: dawn starts 06:30 (Dec–Jan) to 04:30 (Jun–Jul); night starts 20:00 to 22:00;
  dawn and dusk last 60 minutes each.
- Moon phase from a reference new moon (6 Jan 2000) and the synodic month (29.530588853 d),
  evaluated at the midnight that ends the day; 8 named phases + illumination.
- `GameClock.tick(state, dtMs)` / `advance(state, minutes)`: 1 in-world minute per real second
  × speed; a tick covers at most 60 s of real time; pausable. Emits, in order, phase changes,
  `dayChanged`/`midnight`, `witchingMinute` (03:33), `cockCrow` (04:30).
- Calendar system: starts the festival chapter of the day (also mid-festival), increments the
  night index at nightfall, resets per-night/day/chapter abilities, ends the chapter at the dawn
  after its last night, and keeps the `year`, `night-index` and `nights-survived` stats in sync.

## Test ideas

- Orthodox Easter computus for 1834–1878 matches a reference table.
- Unclean Days chapter has exactly 12 nights from 25 Dec to 5 Jan, Theophany dawn on 6 Jan.
- `time/witchingMinute` fires exactly once per night at 03:33.
- Time-skip across 1856 applies the `tax.bedel` anchor and removes `tax.cizye`.
- Hidden-tab pause: simulated 10 minutes hidden ⇒ ≤ 60 s of simulated time.
