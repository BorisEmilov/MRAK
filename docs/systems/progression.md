# Guardian progression — implementation (v1)

Status: v1 · MVP: ✅ · Package: `packages/core/src/guardian` · Back to [GDD](../GDD.md) · [index](README.md)

This is the **implementation hub** of the guardian's growth. It ties together the design specs —
[attributes](attributes.md), [skills](skills.md), [callings](callings.md), [talents](talents.md),
[revelation-xp](revelation-xp.md), [debt](debt.md), [virtue-sin](virtue-sin.md),
[omens](omens.md), [gear-blessings](gear-blessings.md), [journal](journal.md) — and the numbers of
[progression-economy](progression-economy.md). Inspired by career/specialization/obligation
systems of narrative tabletop RPGs, adapted (not copied) to MRAK's folk horror.

Every number below lives in **data**: `data/progression-rules/default.json` (schema
`ProgressionRules`). Core never hardcodes a cost, a threshold or a chance.

## 1. State (`WorldState.guardian`, save version 7)

| Field           | Meaning                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `callingId`     | Calling chosen at creation (`null` = guardian not created yet).               |
| `attributes`    | `Record<attribute, 1..6>`.                                                    |
| `skills`        | `Record<skill, { rank 0..5, cap 0..5, practice }>`.                           |
| `practiceLog`   | `"skill:target" → absolute minute` of the last practice (anti-grind).         |
| `practiceToday` | `{ day, points: Record<skill, n> }` — daily cap for practice by plain use.    |
| `talents`       | Bought cells, `"tree/cell"` (a ranked talent may appear in several trees).    |
| `unlockedTrees` | Trees the guardian owns (native, bought, or opened by a pact).                |
| `revelation`    | `{ lifetime, ledger[] }`; the available amount is the `revelation` stat.      |
| `milestones`    | Granted milestone keys (`id` or `id:target`) — idempotency.                   |
| `virtue`, `sin` | Ids; `virtueActs` this chapter, `boonDay` (last day the +1 Fate was used).    |
| `equipment`     | `Record<slot, gear id \| null>` for weapon, amulet, amulet-2, tool, clothing. |
| `gear`          | Owned gear ids. The lantern stays in `light.lantern`.                         |
| `blessings`     | `gear id → [{ blessing, usesLeft \| null, nightsLeft \| null }]`.             |
| `upgrades`      | `gear id → upgrade ids` done at the workshop.                                 |

Elsewhere: `debt.entries` (+ `debt.history`, `debt.lastNight`), `journal { learned, notes, heir }`,
`abilities[*].readyAt` (cooldowns).

Migration v6 → v7 adds the fields empty; a guardian with `callingId: null` is created from the
calling picker the next time the game opens (rule C1).

## 2. Creation (rules C1–C4)

- **C1.** `createGuardian { calling, tree, bonus, virtue, sin }` is valid only while `callingId`
  is null. All attributes start at `attributes.base` (2); the calling adds +1 to its two
  `attributeBonuses`; the player adds `attributes.playerPoints` (+1) anywhere; nothing above
  `attributes.creationMax` (4).
- **C2.** Calling skills start with cap `skills.callingCap` (2), others `skills.otherCap` (1);
  `startingRanks` start at rank 1.
- **C3.** `tree` must be one of the calling's `trees`: it is owned for free. The calling's
  `startingGear` goes to the pack, `startingEquipment` is owned and equipped, the calling ability
  is granted, Faith is set to `startingFaith`.
- **C4.** Virtue and sin are free choices (the calling's defaults are pre-selected by the UI).

The **10 skills** of v1 (they replace the 17 of the draft): Occultism, Exorcism, Herbalism,
Investigation, Stealth, Combat, Lore, Persuasion, Survival, Faith. A calling has 3–6 calling skills.

## 3. Attributes and skills

- **A1.** `raiseAttribute { attribute }`: cost `attributes.costPerRating × new rating`; maximum
  `attributes.cap` (5) unless a talent/heirloom rule `attribute-max-6` names that attribute.
- **A2.** Derived stats: every `derived` row adds `per × (attribute − base)` to a stat through the
  passive-modifier path (e.g. `sanity-max` +8 per Resolve, `pack-slots` +1 per Vigor,
  `carry-weight` +2 per Vigor).
- **S1. Practice by use.** A check awards practice to its skill: failure 2, success 1, success
  with good omen 2, +1 if difficulty ≥ hard. A plain use (gathering, talking, photographing,
  grinding) awards `practice.use` (1), at most `dailyUseCap` (6) per skill per day.
- **S2. Anti-grind.** The same skill on the same target within `repeatMinutes` (10) awards 0.
- **S3.** When `practice ≥ thresholdFactor × (rank + 1)²` and `rank < cap` → rank +1, practice
  resets (thresholds 6, 24, 54, 96, 150). At the cap, practice accumulates up to the threshold
  and waits: the skill is **ready to grow** (`skill/readyToGrow`).
- **S4. Cap.** `raiseSkillCap { skill }`: cost `capCost × new cap` for calling skills,
  `+ foreignCapExtra` (5) for others. Max cap 5. A waiting skill ranks up at once.

## 4. Revelation (rules R1–R5)

- **R1.** Milestones are content (`data/milestones`): `{ amount, reasonKey, on?, repeat }`.
  `on: { event, match? }` makes core grant it when that core event happens; without `on`, only
  the `{ "milestone": id }` effect grants it (mysteries, exorcisms, quests, buildings…).
- **R2.** `repeat`: `once` (per guardian), `per-target` (once per zone / layer / recipe / clue /
  demon…, keyed `id:target`), `always` (e.g. each night survived).
- **R3.** The trigger list is closed (schema enum) and **contains no kill event**: killing never
  gives Revelation. A test enforces it.
- **R4.** Each award writes the ledger `{ milestone, amount, target?, day, minute }` (shown in the
  journal's Revelation tab) and adds to `lifetime` and the `revelation` stat.
- **R5.** Spending (talents, trees, attributes, caps) is refused at **night** ("not at night").
  Awards made at night are credited at once but the UI announces them at dawn (pillar 1).

## 5. Trees and talents (rules T1–T8)

- **T1.** A tree is a grid (`columns` × rows); a node may be bought when its tree is owned, any
  one of its `requires` cells is owned (row-1 nodes need none), it is not owned yet, and the
  guardian can pay. Cost = row cost (or the node's `cost`); +`foreignPerTalent` (5) in a tree
  of another calling; × `softCapFactor` (1.25, rounded up) once `lifetime > softCapLifetime` (600).
- **T2.** Tree access: the calling's other native tree costs `secondNativeCost` (20) — the
  **second specialization**; a tree of another calling costs `foreignAccess` (30). Dark trees
  cannot be bought: they open only through their `unlock` condition (a pact).
- **T3.** Passive talents: their effects (modifiers, rules, flags) apply on purchase, with source
  `talent:<tree>/<cell>`, so a **ranked** talent bought in two trees stacks.
- **T4.** Active talents: an `ability` effect with `uses/per`, and optional `cooldown` (in-world
  minutes) and `cost { sanity?, light? }` paid on use (light = lantern fuel).
- **T5. Dark trees.** Each purchase adds the row's `rowCorruption`, a debt entry
  (`debtSource` with `rowDebt` of the row), Notice `notice.darkTalent`, and runs
  `onEachPurchase`. Dark talents may set flags read by dialogue and change how villagers see the
  guardian (e.g. `affinity-gain-rate` × 0.5 when talking).
- **T6.** Debt empowers dark talents: a modifier with `perDebt: n` gives its dice ×
  `min(debt.darkScalingMax, floor(debt / n))`.
- **T7.** No refunds.
- **T8.** Preview: `previewTalent` (query) returns cost, Revelation after, Corruption and Debt
  added and why a node is locked, so the UI can show the change before confirming.

## 6. Checks and omens (rules O1–O7)

- **O1.** Request `{ skill, difficulty, context?, target? }`. Fate dice = attribute of the skill
  - skill rank + modifiers; Shadow dice = difficulty (`easy 1 … dire 5`) + modifiers.
- **O2.** Modifiers: talents, equipped gear and its blessings, cursed objects (matching `skill`
  or `context`, or global); today's virtue boon +1 Fate; Sanity < 50 +1 Shadow, < 25 +2; in
  darkness without light +1 Shadow; in a sacred zone (`checks.sacredZones`) −1 Shadow.
  Fate is clamped to [1, 8], Shadow to ≥ 0.
- **O3.** Faces: Fate `1,2 —  3 ☼  4,5 ✔  6 ✔☼`; Shadow `1,2 —  3 ☾  4,5 ✘  6 ✘☾`.
- **O4.** Conversions after the roll, in order: talents (`convertOmen`) → Faith ≥ 60 cancels one
  ☾ → Corruption ≥ 50 turns one ☼ into ☾ ("the Horned One watches").
- **O5.** Success when ✔ − ✘ ≥ 1. Omen = ☼ − ☾: ≥ 3 **great** (extreme, rare), > 0 good, 0
  none, < 0 bad, ≤ −3 **dire** (extreme, rare).
- **O6.** The omen table of the check's context (`omen-tables`, by `context`) maps
  success × omen to a description and effects; extreme omens use `successGreat` / `failureDire`
  when present, else the good/bad cell.
- **O7.** Rolls use the `checks` stream: same seed ⇒ same faces. The result carries every die,
  every modifier with its plain-language reason, and the outcome (UI rule 15).
- Blessings used by a check (their modifier applied) lose one use.

## 7. Debt (rules D1–D6)

- **D1.** Sources (`debt-sources`) have a `kind`: `pact`, `favour`, `loan` (the aga),
  `promise`, `talent`; and a creditor (`horned-one`, `forest-spirit`, `aga`, `village`).
- **D2.** Each **dusk**, one collection roll: chance `min(maxChance, chancePer5 × total / 5)` ×
  `debt-collection-rate`. At most one per night (`debt.lastNight`).
- **D3.** Severity: d100 + total → `< major` Minor, `< grave` Major, else Grave; the rule
  `debt-collection-tier-shift` shifts one tier down.
- **D4.** The debt entry collected is picked weighted by amount; the collection event is picked
  among `debt-collections` of **that entry's creditor** and severity (falling back to a lower tier),
  so the price always matches who is owed. Its effects apply and `debt/collected` is emitted;
  the history keeps `{ day, collection, source, tier }`.
- **D5.** Remedies (`debt-remedies`): `payDebt { remedy }` applies the remedy's cost effects and
  reduces the creditor's entries (oldest first) by `reduce`. Remedies may need conditions.
- **D6.** Signing a pact (`signPact { pact }`) needs the pact's zone and time window (or the
  rule `pacts-anywhere-at-midnight`), applies the offer, adds its debt and opens its dark tree.

## 8. Virtue and sin (rules V1–V5)

- **V1.** Tags `virtue:<id>` / `sin:<id>` on dialogue options and recorded decisions.
- **V2.** Acting by **your** virtue: Faith +`virtue.faith`; the first time each day, a boon of +1
  Fate on the next check; `virtuousAfter` (3) acts in a chapter → flag `virtuous` until the
  chapter ends (+1 Fate on Faith checks via its modifier).
- **V3.** Acting by your sin: Corruption +`sin.corruption`.
- **V4.** Sin **takeover**: in a choice containing an available option tagged with your sin,
  chance `clamp((Corruption − Faith) %, 0, takeoverMax)` that the sin option is chosen instead
  (never when the node is `noSinTakeover`). Event `sin/tookOver`; the UI says so (pillar 6).
- **V5.** Sin **blocking**: with Corruption ≥ `sin.blockAt`, options tagged with a virtue listed
  in your sin's `blocks` are unavailable and marked "your <sin> will not allow it".
- Talking to villagers offers **tones** (data `talk-tones`), each tagged; this is v1's dialogue
  surface for V1–V5 until Ink dialogues land.

## 9. Gear and blessings (rules G1–G5)

- **G1.** Slots: lantern (in `light`), weapon, amulet, amulet-2, tool, clothing. `equipGear
{ slot, gear | null }`; amulets fit either amulet slot. Changing gear at night only at home.
- **G2.** Equipped gear and its live blessings add their modifiers to every check and stat.
- **G3.** `blessGear { gear, blessing }`: the blessing must apply to the gear's slot; needs a free
  blessing slot, its materials, its station (`chapel`: in the village) and its check (good omen
  +1 use; failure wastes the materials). A holy blessing removes dark ones and vice versa.
- **G4.** Durations: uses (spent by checks that used it), nights (counted down at dawn),
  permanent.
- **G5.** `upgradeGear { gear, upgrade }` at the village workshop (in the village, by day):
  materials → +blessing slot or extra effects.

## 10. Forbidden knowledge ("seen by demons")

The hidden `notice` stat (never shown as a number; the sheet only hints "you feel watched").
It rises when learning a demon (+3), gaining a forbidden collectible (+5), on every Occultism
check (+1) and dark talent (+2); −1 each dawn. `directorWeight = 1 + notice / 50` multiplies the
weight of guardian-targeted director events.

## 11. Journal (rules J1–J4)

- **J1.** Tabs: Clues (mystery clues), Demons and Bestiary (`journal.learned`, plus revealed
  possessions), Recipes, People (villagers met: talked to or with secrets), Revelation (ledger),
  Notes (player text, ≤ 500 chars, ≤ 100 notes).
- **J2.** Effects `learnDemon` / `learnCreature` add entries (`journal/learned`).
- **J3.** `markForHeir { entry, heir }` marks entries to pass on, up to `journal-pages`.
- **J4.** Heir inheritance itself belongs to [lineage](lineage.md) (later).

## 12. Simulator (balance)

`simulate({ profile, seed, years })` in core runs abstract nights on the **real** content and the
real rules (milestones, costs, practice, debt rolls). Profiles: `cautious`, `dark`, `investigator`.
It returns one sample per played hour: lifetime Revelation, power index
`P = Σ attributes + Σ skill ranks + 0.5 × talents`, debt and corruption; `compareToPlan` checks
them against the bands in [progression-economy §10](progression-economy.md#10-simulator-bands).
`pnpm --filter @mrak/core simulate` writes the curves to `packages/core/sim-out/` (CSV + JSON).

## Events

`guardian/created`, `attribute/raised`, `skill/practiced`, `skill/rankUp`, `skill/readyToGrow`,
`skill/capRaised`, `revelation/awarded`, `revelation/spent`, `talent/bought`, `tree/bought`,
`check/resolved`, `debt/collected`, `debt/paid`, `pact/signed`, `virtue/acted`, `sin/acted`,
`sin/tookOver`, `gear/equipped`, `gear/blessed`, `gear/blessingFailed`, `gear/blessingExpired`,
`gear/upgraded`, `journal/learned`, `journal/noteWritten`, `journal/noteRemoved`,
`journal/heirMarked`.

## Test ideas

Creation validation; costs (attributes 30/40/50, caps 15/20, talents with foreign/soft cap);
practice thresholds and anti-grind; milestone idempotency and no-kill rule; buying requires
prerequisites; dark purchase adds exact corruption and debt; check pools and enumeration
(3F vs 2S); seed reproducibility; debt chance table and coherent collection; virtue boon once
a day; takeover chance and `noSinTakeover`; blessing conflicts and expiry; simulator bands.
