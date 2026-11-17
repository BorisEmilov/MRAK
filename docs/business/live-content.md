# Live content calendar

Status: v0.1 · Owner: the solo developer · Systems: [seasonal-events](../systems/seasonal-events.md),
[endless-chronicle](../systems/endless-chronicle.md)

The valley must stay alive after the story without burning out one person. The rule: **one
seasonal event per festival, one medium pack per quarter**, nothing else promised.

## Cadence

| When (real date)           | What                                                                    | Size                       | Delivery        |
| -------------------------- | ----------------------------------------------------------------------- | -------------------------- | --------------- |
| February (Kukeri)          | Seasonal event `kukeri-season`                                          | effects + title + 5 Legacy | server calendar |
| 23–25 June (Enyovden)      | Seasonal event `enyovden-herbs`                                         | effects + title + 5 Legacy | server calendar |
| 28 Oct – 8 Nov (All Souls) | Seasonal event `zadushnitsa-candles`                                    | effects + title + 5 Legacy | server calendar |
| 25 Dec – 6 Jan             | Seasonal event `unclean-days-watch`                                     | effects + title + 5 Legacy | server calendar |
| Q1 (March)                 | Medium pack: 2 mystery templates, 6 events, 2 relic talents             | ~1–2 weeks of work         | CDN pack        |
| Q2 (June)                  | Medium pack: 1 handcrafted mystery, 4 events, 1 harvest/disaster set    | ~1–2 weeks                 | CDN pack        |
| Q3 (September)             | Medium pack: newcomer secrets, 2 mystery templates, 4 events            | ~1–2 weeks                 | CDN pack        |
| Q4 (November)              | Medium pack tied to Zadushnitsa: 1 handcrafted mystery, 4 events        | ~1–2 weeks                 | CDN pack        |
| Yearly (January)           | Client update: new systems, bug fixes, new collections allowed in packs | —                          | store / web     |

Seasonal events need no download: their data ships with the client and the server only publishes
which ones are live today. New events of a new kind arrive in the quarterly pack first.

## Rules for a pack

1. Data only (`mysteries`, `events`, `talents`, `trees`, `quests`, `seasonal-events`, `villagers`)
   plus new English locale keys. No code, ever.
2. New ids only: a pack never changes shipped content (the client drops it otherwise).
3. Must pass `pnpm content:validate` merged with the current content before signing.
4. ≤ 2 MB per file. Signed with the studio's Ed25519 key; listed in the CDN `index.json` with its
   size, SHA-256 and signature.
5. Saves stay compatible: packs only add; procedural and pack content referenced by a save is
   registered again when it loads. Removing a pack must not be needed; if it is, ship a client
   migration first.

## Budget (solo)

- Seasonal event: ½–1 day each (data, text, title), 4 per year.
- Medium pack: 1–2 weeks each, 4 per year, written in the month before release.
- Leaves roughly 30 weeks a year for the main game, fixes and the yearly client update.
- If a quarter slips, ship the seasonal events only; never ship an unvalidated pack late.
