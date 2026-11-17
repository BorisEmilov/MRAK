# Talent trees

Status: design v0.1 · **[I]**. Back to [GDD](../GDD.md) · systems: [talents](../systems/talents.md), [revelation-xp](../systems/revelation-xp.md), [progression-economy](../systems/progression-economy.md) · callings: [callings](callings.md).

## Grid rules

- Every tree is a **4 × 3 grid**: rows are tiers **T1–T4**, columns **A, B, C**.
- **Cost (Revelation):** T1 = **5**, T2 = **10**, T3 = **15**, T4 = **20** → full tree = **150**.
- **Prerequisites:** a talent requires the listed cell(s) already bought ("or" = any one).
  T1 cells have no prerequisite.
- **Tree access:** the first tree of your calling is free; the second calling tree costs **20**;
  a tree of another calling costs **30** and its talents cost **+5** each.
- **Shared talents** (e.g. _Grit_) appear in several trees; each purchase is a rank and they stack.
- **Dark trees:** unlocked only by a pact; same Revelation costs **plus Corruption**:
  T1 **+4**, T2 **+6**, T3 **+9**, T4 **+12**. Many dark talents scale with **Debt**.
- Dice notation: **+1F** = add one Fate die; **−1S** = remove one Shadow die (see [omens](../systems/omens.md)).

Grid diagram convention: `│` vertical links (same column, previous tier) are implicit; extra
horizontal links are shown in the prerequisite column.

---

## Priest's Acolyte

### Exorcist (MVP)

```
T1  [A1 Sign of the Cross] [B1 Grit]            [C1 Incense Bearer]
T2  [A2 Know the Enemy]    [B2 Litany]          [C2 Holy Water Discipline]
T3  [A3 Binding Word]      [B3 Unbroken]        [C3 Consecrator] ← B2
T4  [A4 Rite of Casting Out][B4 Shepherd of Souls][C4 Bell of Theophany]
```

| Cell | Talent                | Cost | Effect                                                                         | Prereq   |
| ---- | --------------------- | ---- | ------------------------------------------------------------------------------ | -------- |
| A1   | Sign of the Cross     | 5    | Once per night, −1S on any check against a demon.                              | —        |
| B1   | Grit                  | 5    | +5 max Sanity.                                                                 | —        |
| C1   | Incense Bearer        | 5    | Incense lasts +50%; a lit censer is a light source (radius 2).                 | —        |
| A2   | Know the Enemy        | 10   | Learning a demon's true name also reveals one weakness.                        | A1       |
| B2   | Litany                | 10   | +1F in the Confront phase of exorcisms.                                        | B1       |
| C2   | Holy Water Discipline | 10   | Each dose of holy water has 2 uses.                                            | C1       |
| A3   | Binding Word          | 15   | Bind phase can be attempted without the seal, at +2 Shadow dice.               | A2       |
| B3   | Unbroken              | 15   | A failed exorcism cannot jump to you (this attempt).                           | B2       |
| C3   | Consecrator           | 15   | Once per day, bless one gear slot without materials.                           | C2 or B2 |
| A4   | Rite of Casting Out   | 20   | Cast Out phase: one bad omen becomes neutral.                                  | A3       |
| B4   | Shepherd of Souls     | 20   | After a successful exorcism: host Fear −50, village Hysteria −10.              | B3       |
| C4   | Bell of Theophany     | 20   | Once per chapter: ring the bell — every lesser bes in the village is banished. | C3       |

### Confessor (MVP)

| Cell | Talent             | Cost | Effect                                                                                    | Prereq   |
| ---- | ------------------ | ---- | ----------------------------------------------------------------------------------------- | -------- |
| A1   | Listening Ear      | 5    | +1F on Persuasion in private conversations.                                               | —        |
| B1   | Grit               | 5    | +5 max Sanity.                                                                            | —        |
| C1   | Parish Register    | 5    | See each villager's Fear as a word (calm → terrified).                                    | —        |
| A2   | Seal of Confession | 10   | Once per villager per chapter, a confession gives one secret hint (no check).             | A1       |
| B2   | Calm the Flock     | 10   | +1F on Leadership checks that reduce Hysteria.                                            | B1       |
| C2   | Read the Faces     | 10   | Lies in dialogue are marked with chance 50% + 10% × Wits.                                 | C1       |
| A3   | Penance            | 15   | Assign penance: villager Fear −30, affinity +10; costs one of their task slots for a day. | A2       |
| B3   | Voice of Reason    | 15   | You may always attempt to stop a mob, regardless of affinity.                             | B2       |
| C3   | Sins Laid Bare     | 15   | Possession symptoms become visible one stage earlier.                                     | C2 or A2 |
| A4   | Absolution         | 20   | Once per generation: own Corruption −25, Faith +10.                                       | A3       |
| B4   | Peacemaker         | 20   | Village Hysteria rises 30% slower.                                                        | B3       |
| C4   | Judgement of Souls | 20   | Once per mystery, the board marks one wrong suspect as innocent.                          | C3       |

## Znaharka

### Folk Healer (MVP)

| Cell | Talent                | Cost | Effect                                                                                                             | Prereq   |
| ---- | --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| A1   | Midwife's Hands       | 5    | Healing items restore +25%.                                                                                        | —        |
| B1   | Herb-Lore             | 5    | Herbs are identified automatically when picked.                                                                    | —        |
| C1   | Grit                  | 5    | +5 max Sanity.                                                                                                     | —        |
| A2   | Steady Lead           | 10   | Lead pouring also cures: villager Fear −40.                                                                        | A1       |
| B2   | Dawn Gathering        | 10   | Herbs picked at dawn gain +1 potency.                                                                              | B1       |
| C2   | Fever Breaker         | 10   | Treskavitsi (fever) sickness is cured in one day.                                                                  | C1 or A1 |
| A3   | Bonesetter            | 15   | Injuries (guardian and villagers) heal in half the time.                                                           | A2       |
| B3   | Tincture Master       | 15   | Alchemy brews yield +1 dose.                                                                                       | B2       |
| C3   | Kitchen Garden        | 15   | Herbalist's hut produces +2 herbs per day.                                                                         | C2       |
| A4   | Breath of Life        | 20   | Once per chapter: save a dying villager or yourself (Last Breath auto-success).                                    | A3       |
| B4   | Enyo's Blessing       | 20   | Enyovden herbs ×3 potency; once per chapter treat any gathering as Enyovden.                                       | B3       |
| C4   | The Village Remembers | 20   | Each villager you healed this generation: household affinity +5; mobs cannot target you while you have healed ≥ 3. | C3       |

### Charm-Speaker (MVP)

| Cell | Talent                | Cost | Effect                                                                             | Prereq |
| ---- | --------------------- | ---- | ---------------------------------------------------------------------------------- | ------ |
| A1   | Baene                 | 5    | Charm off the evil eye: removes stage-1 symptoms of Uroka and fevers.              | —      |
| B1   | Red Thread            | 5    | Craft red-thread amulets (blessing: −1S vs lesser besove).                         | —      |
| C1   | Listening to Water    | 5    | +1F on Occultism to detect possession in the same house.                           | —      |
| A2   | Charm the Lesser      | 10   | Banish a lesser bes from a villager without the full ritual.                       | A1     |
| B2   | Knotwork              | 10   | Amulets you craft have 2 charges.                                                  | B1     |
| C2   | Speak with the Forest | 10   | Forest-spirit bargains cost one memory less (min 1).                               | C1     |
| A3   | Turning Charm         | 15   | Reflect a magiya onto its maker (maker gains stage-1 symptoms; you +5 Corruption). | A2     |
| B3   | Woven Ward            | 15   | Warded house: possession progression chance halved.                                | B2     |
| C3   | Moon Lore             | 15   | When the moon is pulled down, keep 50% of light radius.                            | C2     |
| A4   | Unmaking              | 20   | Destroy a magiya from afar once its maker is known.                                | A3     |
| B4   | Ward the Village      | 20   | Once per chapter, ward every house for one night.                                  | B3     |
| C4   | Samodiva's Favour     | 20   | Samodivi dance circles restore Sanity instead of draining it.                      | C3     |

## Hunter

### Witch Hunter

_Hunts the real thing — and learns that most "witches" are not._

| Cell | Talent              | Cost | Effect                                                                    | Prereq |
| ---- | ------------------- | ---- | ------------------------------------------------------------------------- | ------ |
| A1   | Hawthorn Stakes     | 5    | Craft hawthorn stakes (vampires, talasami).                               | —      |
| B1   | Tracker's Eye       | 5    | Creature tracks visible at night.                                         | —      |
| C1   | Grit                | 5    | +5 max Sanity.                                                            | —      |
| A2   | Garlic and Iron     | 10   | Iron-blessed weapons deal +1 damage tier to creatures.                    | A1     |
| B2   | Know the Signs      | 10   | First encounter reveals one bestiary weakness.                            | B1     |
| C2   | Steady Hand         | 10   | +1F on Marksmanship.                                                      | C1     |
| A3   | Vampirdzhiya's Way  | 15   | Detect which graves hold a rising vampire.                                | A2     |
| B3   | The Innocent's Mark | 15   | When hysteria accuses someone of witchcraft, reveal one exonerating clue. | B2     |
| C3   | Silver Shot         | 15   | Silver ammunition: ignores lamia and vampire regeneration.                | C2     |
| A4   | Burn the Nest       | 20   | Destroy a creature lair permanently (zone variant changes).               | A3     |
| B4   | Truth Over Fire     | 20   | Presenting one valid clue stops a witch-hunt mob outright.                | B3     |
| C4   | Last Shot           | 20   | Once per night, a guaranteed hit with a good omen.                        | C3     |

### Tracker

| Cell | Talent             | Cost | Effect                                                       | Prereq |
| ---- | ------------------ | ---- | ------------------------------------------------------------ | ------ |
| A1   | Pathfinder         | 5    | Once per night, reveal one true path through shifting paths. | —      |
| B1   | Light Feet         | 5    | Footstep noise −30%.                                         | —      |
| C1   | Trapper            | 5    | Craft snares (animals → food).                               | —      |
| A2   | Read the Fog       | 10   | Visibility in fog +2 tiles.                                  | A1     |
| B2   | Wolf's Patience    | 10   | Stamina regenerates ×2 while hidden.                         | B1     |
| C2   | Hunter's Larder    | 10   | Hunting yields +50% food.                                    | C1     |
| A3   | Home Before Dawn   | 15   | Return route marked; dawn penalty halved.                    | A2     |
| B3   | Ghost of the Woods | 15   | Samodivi detect you only within 2 tiles.                     | B2     |
| C3   | Snares of Iron     | 15   | Iron snares hold creatures for 3 s.                          | C2     |
| A4   | Map of the Night   | 20   | Once per night, freeze all shifting paths.                   | A3     |
| B4   | Unseen             | 20   | Once per night, become undetectable for 10 s.                | B3     |
| C4   | Provider           | 20   | Village food production +10% while you are guardian.         | C3     |

## Scholar

### Investigator

| Cell | Talent              | Cost | Effect                                                                | Prereq   |
| ---- | ------------------- | ---- | --------------------------------------------------------------------- | -------- |
| A1   | Keen Eye            | 5    | +1F on Investigation.                                                 | —        |
| B1   | Notebook            | 5    | Journal +2 pages.                                                     | —        |
| C1   | Grit                | 5    | +5 max Sanity.                                                        | —        |
| A2   | Cross-Reference     | 10   | The deduction board shows contradictions between linked clues.        | A1       |
| B2   | Interview           | 10   | One extra question per villager per day.                              | B1       |
| C2   | Lamp Reading        | 10   | Reading documents at night costs no oil.                              | C1       |
| A3   | Chain of Evidence   | 15   | Linking 3 clues to one proposition: +5 Revelation (once per mystery). | A2       |
| B3   | Witness Memory      | 15   | Ask witnesses about past days' events.                                | B2       |
| C3   | Daguerreotypist     | 15   | Use a camera (from 1858); plates can reveal presences.                | C2       |
| A4   | The Whole Picture   | 20   | Once per mystery, the board highlights the missing clue type.         | A3       |
| B4   | Records of the Kadı | 20   | Request court documents from the aga's archive (legal evidence).      | B3       |
| C4   | Clear Mind          | 20   | Hallucinated clues are marked "doubtful" with 50% chance.             | C3 or A3 |

### Occultist

| Cell | Talent           | Cost | Effect                                                 | Prereq |
| ---- | ---------------- | ---- | ------------------------------------------------------ | ------ |
| A1   | Sigil Reader     | 5    | +1F on Occultism to read seals.                        | —      |
| B1   | Forbidden Index  | 5    | Notice gained from forbidden entries −20%.             | —      |
| C1   | Candle Ritualist | 5    | Ritual candles last ×2.                                | —      |
| A2   | True Names       | 10   | A true name needs half the grimoire fragments.         | A1     |
| B2   | Circle of Ash    | 10   | Draw a circle lesser besove cannot cross (one night).  | B1     |
| C2   | Thracian Letters | 10   | Read Thracian inscriptions.                            | C1     |
| A3   | Bind the Lesser  | 15   | Command a lesser bes for one night (+3 Corruption).    | A2     |
| B3   | Ward of Names    | 15   | Speaking a known true name stuns that demon for 3 s.   | B2     |
| C3   | Grimoire Binder  | 15   | Combine grimoire pages into new rituals.               | C2     |
| A4   | Speaker of Seals | 20   | Bind a named demon without the seal's medium.          | A3     |
| B4   | Mirror of Notice | 20   | Move Notice into a cursed object (and carry the risk). | B3     |
| C4   | The Old Tongue   | 20   | Address the Horseman's sanctuary (route content).      | C3     |

## Haidut

### Shadow Walker

| Cell | Talent                | Cost | Effect                                                 | Prereq |
| ---- | --------------------- | ---- | ------------------------------------------------------ | ------ |
| A1   | Night Eyes            | 5    | See 1 tile further without light.                      | —      |
| B1   | Quiet Step            | 5    | Footstep noise −30%.                                   | —      |
| C1   | Grit                  | 5    | +5 max Sanity.                                         | —      |
| A2   | Dark Walk             | 10   | Move without light for 30 s with no Sanity loss.       | A1     |
| B2   | Light Fingers         | 10   | Take items from houses at night (Stealth check).       | B1     |
| C2   | Yatak Network         | 10   | Haidut safe houses become rest points.                 | C1     |
| A3   | Shadow Step           | 15   | Dash between two dark tiles.                           | A2     |
| B3   | Lockbreaker           | 15   | Open locks without tools.                              | B2     |
| C3   | Smugglers' Paths      | 15   | Hidden routes between zones.                           | C2     |
| A4   | One with the Night    | 20   | Darkness no longer drains Sanity.                      | A3     |
| B4   | Ghost of Mrak         | 20   | Villagers never witness your night actions.            | B3     |
| C4   | The Mountains Provide | 20   | Once per chapter, haiduti supply powder, food and oil. | C3     |

### Voivoda

| Cell | Talent           | Cost | Effect                                                        | Prereq   |
| ---- | ---------------- | ---- | ------------------------------------------------------------- | -------- |
| A1   | Commanding Voice | 5    | +1F on Leadership.                                            | —        |
| B1   | Hard Look        | 5    | +1F on Intimidation.                                          | —        |
| C1   | Grit             | 5    | +5 max Sanity.                                                | —        |
| A2   | Rally            | 10   | Villagers on watch duty: Fear gain −50%.                      | A1       |
| B2   | Haidut's Oath    | 10   | Recruit a haidut companion for one night.                     | B1       |
| C2   | Arms Cache       | 10   | +2 weapon slots in the village store.                         | C1       |
| A3   | Militia          | 15   | Watchtower defence ×1.5.                                      | A2       |
| B3   | Defy the Aga     | 15   | +1F negotiating taxes and inquiries (risk: aga standing).     | B2       |
| C3   | Fearless Example | 15   | Your Fear never spreads to villagers.                         | C2 or A2 |
| A4   | Gergyovden Band  | 20   | Once per year, a haidut band defends the village for a night. | A3       |
| B4   | Folk Hero        | 20   | Reputation gains +50%.                                        | B3       |
| C4   | Last Stand       | 20   | Once per night, at 0 health keep fighting 10 s.               | C3       |

## Gravedigger

### Deathwatcher

| Cell | Talent                | Cost | Effect                                                                 | Prereq |
| ---- | --------------------- | ---- | ---------------------------------------------------------------------- | ------ |
| A1   | Grave Sense           | 5    | Sense disturbed graves within the zone.                                | —      |
| B1   | Grit                  | 5    | +5 max Sanity.                                                         | —      |
| C1   | Funeral Rites         | 5    | Funerals you lead: vampire risk 0, Faith +2.                           | —      |
| A2   | Forty Days            | 10   | Know how many days a soul has left before departing.                   | A1     |
| B2   | Voices of Zadushnitsa | 10   | One extra question to the dead on Zadushnitsa.                         | B1     |
| C2   | Kolivo                | 10   | Kolivo offerings calm restless dead (no fight).                        | C1     |
| A3   | Death's Calendar      | 15   | See Kostobroy's symptom stage on any villager.                         | A2     |
| B3   | Lay to Rest           | 15   | Navi can be named and laid to rest.                                    | B2     |
| C3   | Corpse Reader         | 15   | +2F on Investigation on bodies.                                        | C2     |
| A4   | Escort of Souls       | 20   | Guide a lost soul: +10 Revelation once per chapter.                    | A3     |
| B4   | Last Words            | 20   | The recently dead answer one question (any night).                     | B3     |
| C4   | The Dead Remember     | 20   | A past guardian's ghost restores one lost journal page per generation. | C3     |

### Grave Warden

| Cell | Talent              | Cost | Effect                                                                | Prereq |
| ---- | ------------------- | ---- | --------------------------------------------------------------------- | ------ |
| A1   | Strong Back         | 5    | Carry capacity +4 slots.                                              | —      |
| B1   | Spade Fighter       | 5    | +1F on Combat with tools.                                             | —      |
| C1   | Hawthorn Hedge      | 5    | Plant hawthorn: creatures avoid that edge.                            | —      |
| A2   | Salt Lines          | 10   | Salt thresholds last a whole chapter.                                 | A1     |
| B2   | Bell Ringer         | 10   | Ringing the bell at night repels lesser besove for 1 hour.            | B1     |
| C2   | Lantern Posts       | 10   | Place fixed lanterns (3) in a zone.                                   | C1     |
| A3   | Consecrated Ground  | 15   | The cemetery cannot be desecrated while you are guardian.             | A2     |
| B3   | Unflinching         | 15   | Immune to fear stuns.                                                 | B2     |
| C3   | Vigil Keeper        | 15   | Night watch task by you also produces +1 Faith per villager on watch. | C2     |
| A4   | Warden of the Field | 20   | Creatures cannot rise inside the cemetery.                            | A3     |
| B4   | Iron Will           | 20   | +1 Resolve (max 6).                                                   | B3     |
| C4   | Sexton's Bell       | 20   | Once per chapter, end the night 1 hour early.                         | C3     |

---

## Dark trees

Dark talents are the most powerful in the game. Every purchase adds Corruption
(T1 +4, T2 +6, T3 +9, T4 +12 → **+93** for a full tree) and many scale with **Debt** (D).

### Servant of the Horned One (MVP)

**Unlocked by:** signing any pact at the crossroads ([pacts](../systems/pacts.md)).

| Cell | Talent                   | Cost | Corr. | Effect                                                                 | Prereq   |
| ---- | ------------------------ | ---- | ----- | ---------------------------------------------------------------------- | -------- |
| A1   | Crossroads Tongue        | 5    | +4    | +1F on Persuasion, +1 more per 10 D (max +3F).                         | —        |
| B1   | Devil's Luck             | 5    | +4    | Once per night, reroll a whole check; +2 Debt.                         | —        |
| C1   | Black Candle             | 5    | +4    | A light only you can see — creatures ignore it.                        | —        |
| A2   | Silver Tongue            | 10   | +6    | Sin dialogue options available without sin dominance.                  | A1       |
| B2   | Friend of the Collector  | 10   | +6    | Debt collections are one severity tier lower.                          | B1       |
| C2   | Horned Shadow            | 10   | +6    | Your Notice is shifted onto another villager for one night.            | C1       |
| A3   | Borrowed Strength        | 15   | +9    | +1 to an attribute for one night; +3 Debt.                             | A2       |
| B3   | Whisper to the Possessed | 15   | +9    | Command a possessed villager once per night.                           | B2 or A2 |
| C3   | Contract Reader          | 15   | +9    | See one hidden clause of every pact.                                   | C2       |
| A4   | Midnight Anywhere        | 20   | +12   | Sign pacts at any crossroads-like place (forks, doorways) at midnight. | A3       |
| B4   | Sovereign of Debt        | 20   | +12   | All Debt scaling in this tree doubles.                                 | B3       |
| C4   | Horned Crown             | 20   | +12   | Once per generation, banish a named demon instantly; +10 Debt.         | C3       |

### Bride of the Forest (full game)

**Unlocked by:** accepting the forest spirit's betrothal (a pact with Stana). "Bride" is her word,
used for every guardian regardless of gender. Each talent additionally costs **one memory** (a
journal entry chosen by the spirit is erased).

| Cell | Talent               | Cost | Corr. | Effect                                                                | Prereq |
| ---- | -------------------- | ---- | ----- | --------------------------------------------------------------------- | ------ |
| A1   | Green Sight          | 5    | +4    | See the spirit's marks and hidden forest paths.                       | —      |
| B1   | Root Paths           | 5    | +4    | Forest paths never shift for you.                                     | —      |
| C1   | Moonmilk             | 5    | +4    | When the moon is pulled down, you still see 3 tiles.                  | —      |
| A2   | Gift of Memory       | 10   | +6    | Spend a memory instead of oil to fuel a light burst.                  | A1     |
| B2   | Dance with Them      | 10   | +6    | Join samodivi dances: full Sanity restore once per night.             | B1     |
| C2   | Pull Down the Moon   | 10   | +6    | Once per chapter, cause a pitch-black night.                          | C1     |
| A3   | Forest's Wrath       | 15   | +9    | Forest creatures attack whoever harms you in the forest.              | A2     |
| B3   | Thorn Ward           | 15   | +9    | Brambles block a path for one night.                                  | B2     |
| C3   | Her Name             | 15   | +9    | Speak Stana's name: she answers truthfully once. Requires knowing it. | C2     |
| A4   | Vengeance of 1779    | 20   | +12   | Curse a bloodline: the Zlatevi suffer Mrak's misfortunes for a year.  | A3     |
| B4   | The Forest Keeps You | 20   | +12   | Once per generation, dying in the forest returns you at dawn.         | B3     |
| C4   | Becoming             | 20   | +12   | At Corruption 100 you become hers — unlocks the forest ending.        | C3     |
