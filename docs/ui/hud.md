# HUD

Status: v1 · Code: `apps/game/src/ui/hud/` · Back to [UI index](README.md) ·
[design system](design-system.md)

## Purpose

Show only what the player needs to decide the next step, in icons with tooltips, and get out of
the way otherwise.

## Layout (16:9; stacks on narrow screens)

| Area          | Content                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Top left      | **Resources**: light, food, faith, corruption (`ResourceCounter`) and **sanity** (`ProgressMeter`, no numbers) |
| Top right     | **Time**: phase icon (dawn/day/dusk/night), hh:mm, date, moon; chapter and night n/12                          |
| Right column  | **Village notices** (max 3, newest first, 12 s each): deaths, hysteria jumps, director events, quests          |
| Bottom centre | **Interaction prompt**: action icon + verb + target + `KeyHint` (keyboard or gamepad glyph)                    |
| Bottom right  | Save indicator; glossary button (`?`)                                                                          |

Resource sources (until dedicated systems exist): light = `lamp-oil` + `beeswax` in inventory,
food = `bread`, faith/corruption = guardian stats, sanity = `sanity` / `sanity-max`.

## Fading

- The HUD is **dimmed to 35 %** after 6 s without a relevant change, when the player is moving and
  nothing is wrong. It returns to full opacity immediately when a value changes, a notice arrives,
  an interaction is available, sanity is low (< 40 % of max), night starts, the pointer hovers it,
  or the player presses `Tab` / gamepad `View`.
- Option **HUD: auto-fade** (default on). Never fades below 35 %; the interaction prompt never fades.

## Events

- Consumes: UI store snapshot (≤ 10 Hz), recent core events, `world:interaction` on the UI bus
  (`{ action, targetKey } | null`, emitted by Phaser when the guardian is near something).

## Test ideas

- Renders counters with tooltips; sanity has no number in its accessible name.
- Notices appear for a villager death and expire.
- Fades after inactivity; un-fades on change; never fades with auto-fade off.
