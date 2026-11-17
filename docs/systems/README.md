# System specs

One file per game system, written **before** any code (see [CLAUDE.md](../../CLAUDE.md)).
Back to [GDD](../GDD.md).

Every spec has: Purpose · Data · Rules · Initial formulas · Events (emitted/consumed) ·
Edge cases · **Test ideas**. Numbers come from [progression-economy](progression-economy.md),
which wins on conflict.

| Group         | Specs                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation    | [world-state](world-state.md) · [time-calendar](time-calendar.md) · [save-system](save-system.md) · [content-model](content-model.md) · [conditions-effects](conditions-effects.md) · [game-app](game-app.md) · [asset-pipeline](asset-pipeline.md) · [onboarding](onboarding.md) |
| Village (day) | [villagers](villagers.md) · [tasks](tasks.md) · [inventory](inventory.md) · [alchemy](alchemy.md) · [collection](collection.md) · [photography](photography.md) · [village-growth](village-growth.md) · [hysteria](hysteria.md)                                                   |
| Guardian      | [attributes](attributes.md) · [skills](skills.md) · [callings](callings.md) · [talents](talents.md) · [revelation-xp](revelation-xp.md) · [virtue-sin](virtue-sin.md) · [gear-blessings](gear-blessings.md) · [sanity](sanity.md) · [corruption](corruption.md)                   |
| Checks        | [omens](omens.md) · [progression (v1 implementation hub)](progression.md)                                                                                                                                                                                                         |
| Narrative     | [journal](journal.md) · [dialogue](dialogue.md) · [quests](quests.md) · [mysteries](mysteries.md) · [event-director](event-director.md)                                                                                                                                           |
| Occult        | [possession](possession.md) · [exorcism](exorcism.md) · [pacts](pacts.md) · [debt](debt.md) · [sacrifices](sacrifices.md)                                                                                                                                                         |
| Night         | [night-exploration](night-exploration.md) · [combat](combat.md) · [light](light.md) · [maps](maps.md)                                                                                                                                                                             |
| Long term     | [lineage](lineage.md) · [bloodline-tree](bloodline-tree.md) · [endless-chronicle](endless-chronicle.md) · [seasonal-events](seasonal-events.md) · [achievements](achievements.md) · [progression-economy](progression-economy.md)                                                 |

## Event naming

Domain events are `<domain>/<pastTense>` (e.g. `time/nightStarted`). They are core events, not
the UI EventBus; the game layer forwards a subset to React and Phaser.
