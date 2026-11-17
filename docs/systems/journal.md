# Journal (and forbidden knowledge)

Status: v1 (implemented, see [progression](progression.md)) · MVP: ✅ · Package: `packages/core/journal` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

The guardian's book: clues, demon lore, recipes, folk tales, collectibles. It is **the only way
knowledge passes to the next generation**. It is also dangerous: the more forbidden things you
know, the more the demons **notice** you.

## Data

- Entry: `{ id, kind (clue|truth|demon|seal|recipe|tale|collectible|note), contentId, forbidden: bool,
pages: 1–3, writtenBy (guardianId), inherited: bool }`.
- `journal.capacity` pages (base **24**, +calling/talent/Bloodline bonuses).
- Collectibles: grimoire pages, cursed objects (with memories), relics, daguerreotypes (from 1858),
  folk tales with real clues.
- `guardian.notice` 0–100.

## Rules

1. Learning something adds a **draft** entry automatically; the player must **write it in** (costs
   pages) for it to survive the guardian's death. Drafts die with the guardian.
2. **Inheritance:** an heir receives all written entries. Inherited demon names/seals are usable
   immediately; inherited recipes are known; inherited clues give use points to related skills.
3. **Forbidden entries** (true names, grimoire rituals, Pact clauses) raise **Notice**.
4. Notice effects: the [event director](event-director.md) targets the guardian more often;
   demons' detection range at night +; at 75+ the guardian may be "seen" in dreams (possession risk).
5. The forest spirit and Bride talents can **erase** entries (memory as price).
6. Folk tales are written in period voice and contain one real clue each (pillar 5).

## Initial formulas

- Notice gain: forbidden entry learned +5, written +5 more; per night −1 natural decay
  (−3 if the guardian attends a church service that day).
- Director weight multiplier for guardian-targeted events: `1 + notice/50`.

## Events

- **Emits:** `journal/entryDrafted`, `journal/entryWritten`, `journal/entryErased`,
  `journal/truthAdded`, `notice/changed`.
- **Consumes:** `mystery/clueFound`, `exorcism/nameLearned`, `lineage/heirChosen`, `pact/clauseRevealed`.

## Edge cases

- Journal full → must remove (strike out) an entry to write a new one; struck entries are gone.
- Inheriting more pages than the heir's capacity → heir chooses which to keep (one-time screen).
- An erased entry that was a prerequisite of a mystery clue → the clue becomes "half-remembered"
  (still on the board, cannot be used to prove a conclusion until rediscovered).

## Test ideas

- Drafts are not inherited; written entries are.
- Capacity is enforced; overflow requires explicit strike-out.
- Notice increases by 10 for a forbidden entry learned and written; decays by 1 per night.
- Director multiplier at notice 50 = 2.0.
