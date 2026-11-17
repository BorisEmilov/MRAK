# Writing style — the English voice of MRAK

Status: v0.1. Back to [GDD](GDD.md) · glossary: [lore/glossary](lore/glossary.md).

## The voice in one sentence

**Sober, concrete, period-appropriate English that sounds translated from a village elder's
memory — plain words, cold details, and silence where a modern writer would explain.**

## Principles

1. **Dread through restraint.** Describe what is seen, heard, smelled — not how frightening it is.
   - ✔ "The bell rang three times. Petko was asleep in his chair, the key on his belt."
   - ✘ "A terrifying, bone-chilling bell echoes through the night!"
2. **Concrete before abstract.** Bread, wool, tallow, wet ash, the smell of the river. The world
   is poor and physical.
3. **Short sentences at night, longer ones by day.** Rhythm mirrors the loops.
4. **Never confirm the supernatural in narration** (pillar 4). Narration reports perception:
   "You saw", "it seemed", "Velika says". Only characters assert.
5. **Faith is sincere.** Priests, Muslim neighbours, the herb-woman — everyone believes something
   seriously. No mockery of religion, no "enlightened" sneering at peasants.
6. **No modern slang or idioms.** No "okay", "guys", "creepy", "freak out", "deal with it",
   "vibe", "trauma dump". Prefer "very well", "enough", "God keep you", "Lord have mercy".
7. **No pastiche.** Avoid faux-archaic "thee/thou", "ye olde". 19th-century plainness, not Shakespeare.
8. **Violence is heavy.** Deaths are reported, mourned and remembered. Never comic.

## Dialogue

- Villagers speak in short, indirect sentences with proverbs (adapted from real Bulgarian
  sayings, translated, never invented as "real" — invented ones are marked in content metadata).
- Forms of address: _Otche_ (to a priest, "Father"), _Bai_ (older man), _Lelyo_ / _Lelya_ (aunt),
  _Babo_ (grandmother), _Chorbadzhi_ (to a notable), _Aga_ (to the aga). Keep them untranslated
  in dialogue; explain in the glossary.
- The Horned One speaks politely, precisely, like a notary. Never cackles.
- The forest spirit speaks in fragments of folk song, in second person.
- Ottoman officials speak as officials: formal, procedural, sometimes humane, sometimes harsh —
  as individuals, never as a caricature of a people.

## Folklore terms

1. Keep the **transliterated term** in italics on first use per scene, then plain:
   _karakondzhul_, _samodiva_, _kukeri_, _znaharka_.
2. Give an **in-context hint** the first time a term appears in the game ("the karakondzhul — the
   thing that rides men in the Unclean Days"), and a tooltip linked to the [glossary](lore/glossary.md) (pillar 6).
3. Plurals follow Bulgarian when established in English sources (_samodivi_, _kukeri_, _haiduti_,
   _besove_); otherwise use the singular + English context.
4. Do not translate names of feasts that have no English equivalent (Enyovden, Zadushnitsa);
   translate those that do (Theophany, Christmas Eve) with the Bulgarian name in the glossary.
5. Mark invented lore as invented in design docs (never in player-facing text).

## Historical rigour

- Use correct terms: aga, kadı, chorbadzhiya, zaptiye (from the 1840s), cizye (until 1856).
- Muslims and Christians in the Rhodopes shared language, songs and many beliefs; show
  neighbours, not "the Turk" as a monster. Oppression and violence are real and shown through
  specific acts by specific people.
- Anachronism check: no photography before 1858 in game, no chitalishte before 1856, no railway in the Rhodopes.

## UI text

- UI labels are modern-clear, not period (pillar 6): "Assign task", "Save", "Talents".
- Tooltips: one sentence of effect in plain numbers, one line of flavour in period voice.
- All strings via localization keys (`locales/en.json`); keys are `area.context.item`
  (e.g. `ui.tasks.assign`, `dlg.neda.charm.01`).

## Checklist for every text

- [ ] Would a villager in 1834 understand the words (in translation)?
- [ ] Does it describe rather than label the fear?
- [ ] Does narration avoid confirming the supernatural?
- [ ] Are folklore terms hinted/glossed on first use?
- [ ] No modern slang, no mockery of faith, no ethnic caricature?
