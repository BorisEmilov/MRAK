# Player hub (website, signed in)

Status: v1 · Back to [UI index](README.md) · store: [store](../systems/store.md) · saves:
[saves](../systems/save-system.md)

A signed-in player is not a visitor: the website stops selling the game to them and becomes their
home — who their guardian is, where the chronicle stands, and the shortest way back into it.

## Signed-in header

The static header renders both variants; a bundled script (`src/scripts/header.ts`, no inline
script for the CSP) shows one. The switch is a **hint** in `localStorage` (`mrak.player`:
display name and edition only — never a token, CLAUDE.md), written by the hub after the session
resumes and removed on logout or when the session is gone. A stale hint is harmless: the hub
itself checks the session and sends the player to log in.

| Visitor                       | Player                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| MRAK home · Editions · Log in | Your hub (display name) · Editions (only without the full game) |
| **Play free**                 | **Play**                                                        |

The home page's main call to action follows the same rule ("Play the demo free" → "Open your
hub").

## Hub (`/account/`)

1. **Welcome** — "Welcome back, {name}", the edition badge (Free demo / Full game / Collector's
   edition), Log out.
2. **Your chronicle** (main card) — from the newest cloud save (`GET /v1/saves`, then the save
   itself for the guardian): game date, place, generation, play time, last played. Actions:
   - **Resume game** → `PLAY_URL?play=continue` (only when a save exists);
   - **New game** → `PLAY_URL?play=new`;
   - without the full game: **Get the full game** → `/buy/`.
     No cloud save yet: "Begin your chronicle" with New game only.
3. **Guardian** — name, calling, the six attributes (1–6), sanity, faith, Revelation, the deeds of
   the generation (chapters, mysteries, buildings, routes), talents and Bloodline nodes. Read from
   the save JSON defensively: anything missing is simply not shown.
4. **Progress** — achievements (count, bar, the three most recent).
5. **Tabs** for everything else: Achievements (full list) · Purchases (editions, collector's
   villager name) · Security (display name, password, sessions) · Privacy (export, delete).

Names come from the game's locale (`name.*`, `calling.*.name`, `attribute.*.name`, zone names,
three stat names), passed to the island as props by the page; nothing is hardcoded.

## Game deep link

`?play=continue` resumes the newest save once the menu has its save list (cloud saves sync first
for a signed-in player); `?play=new` starts a new chronicle exactly like the menu's New Game. The
parameter is removed from the address bar right away, so a reload does not repeat it. Unknown
values are ignored.

## Accessibility

Tabs follow the WAI-ARIA tabs pattern (`role=tablist`, arrow keys, `aria-selected`); stats are
text, never colour alone; every action is a real link or button.
