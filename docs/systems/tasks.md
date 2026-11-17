# Tasks

Status: v1 · MVP: ✅ · Package: `packages/core/src/village` · Back to [GDD](../GDD.md) · [index](README.md)

## Purpose

The day-management verbs: assign villagers to work that produces resources and protection for
the night. Tasks keep running while the guardian is away (real time at night).

## Data

| Task           | Duration    | Output                                | Requirements               | MVP |
| -------------- | ----------- | ------------------------------------- | -------------------------- | --- |
| Firewood       | 4 h         | +4 firewood                           | Axe, Vigor-ish trade bonus | ✅  |
| Garlic & herbs | 3 h         | +2 garlic or +2 herbs                 | Herbalist's hut for herbs  | ✅  |
| Amulet-making  | 4 h         | +1 amulet (red thread / garlic braid) | Materials                  | ✅  |
| Night watch    | whole night | Village defence; early warnings       | Fear < 80, lantern oil 1   | ✅  |
| Prayer vigil   | whole night | +Faith (village), −Hysteria           | Chapel                     | ✅  |
| Bake bread     | 3 h         | +3 food                               | Flour                      | ✅  |
| Tend the sick  | 4 h         | Health +20 to one villager            | —                          | ✅  |
| Mill grain     | 4 h         | +3 flour                              | Mill working               | ✅  |
| Repair         | 6 h         | Building condition +25                | Materials                  | —   |
| Teach (school) | 4 h         | Villager skill growth                 | School                     | —   |

Each assignment: `{ villagerId, taskId, startMinute, progress }`.

## Rules

1. One task per villager per day slot (day) and one per night slot.
2. **Efficiency** depends on trade match, health and fear.
3. **Night tasks** can be interrupted by director events (watchman flees, vigil candle snuffed).
4. Output is applied at completion; partial work is kept for the next slot (50%).
5. The guardian can perform tasks themselves during the day (skill-use XP applies).

## Initial formulas

- `efficiency = base(1.0) × (tradeMatch ? 1.25 : 1.0) × (health / 100) × (1 − fear / 200)`.
- Night watch defence value = Σ watchers' `efficiency × 10`, + watchtower level × 10.

## Events

- **Emits:** `task/assigned`, `task/progressed`, `task/completed`, `task/interrupted { cause }`.
- **Consumes:** `time/*`, `villager/panicked`, `villager/died`, `director/eventFired`.

## Edge cases

- Assigned villager becomes possessed → task still runs but output may be sabotaged (hidden).
- Resource cap reached → output wasted with a notice ("the woodshed is full").
- Building destroyed mid-task → task cancelled, partial progress lost.

## Test ideas

- Trade match + full health + fear 0 ⇒ efficiency exactly 1.25.
- Fear 100 ⇒ efficiency halves.
- A night watch interrupted at 02:00 still contributes defence until 02:00 only.
- Cannot assign the same villager to two tasks in one slot.
- Offline-equivalent: simulating a night with the guardian in the forest produces the same task
  outputs as with the guardian in the village (village lives on).

## Implementation (v1)

MVP tasks (`data/tasks/tasks.json`; place = village POI or the villager's `home`):

| Task          | Slot  | Batch | Consumes      | Output (per batch)   | Place    |
| ------------- | ----- | ----- | ------------- | -------------------- | -------- |
| `firewood`    | day   | 4 h   | —             | +4 firewood          | woodpile |
| `garlic`      | day   | 3 h   | —             | +2 garlic            | garden   |
| `amulets`     | day   | 4 h   | 1 red thread  | +1 red-thread amulet | home     |
| `food`        | day   | 3 h   | —             | +3 bread             | tavern   |
| `repairs`     | day   | 6 h   | 2 firewood    | +25 village repair   | woodpile |
| `ritual-prep` | day   | 4 h   | 1 beeswax     | +1 incense           | church   |
| `watch`       | night | —     | 1 oil / night | defence 10           | bonfire  |

1. `assignTask { villager, slot, task | null }`. Rejected: dead/returned/sick villagers, a task of
   the other slot, unmet `requires`, and night tasks for a villager with fear ≥ 80 ("too afraid").
   Changing a slot's task resets its progress.
2. Villagers work only during their routine's `work` blocks (night tasks: the whole night phase),
   at the task's place. Each hour adds `minutes × efficiency` to the slot's progress.
3. A batch finishes when progress reaches its duration: its materials are taken from the stores
   then (missing → `task/stalled`, progress waits) and the batch is **pending**.
4. **At dusk** pending batches are delivered (`task/completed` per villager, one
   `task/delivered { items }` summary): this is when the stores change. Half of the unfinished
   progress carries over to the next day.
5. **Watch:** at nightfall each watcher burns 1 lamp oil (none → `task/interrupted {cause:
no-oil}`); every night hour `night-watch` = Σ efficiency × 10 of watchers on duty; a watcher
   whose fear reaches 80 flees (`task/interrupted {cause: fear}`, task cleared). Reset at dawn.
6. **Efficiency** = Π trait multipliers for the task (trade traits play the "trade match" role:
   miller → food 1.25, herb-woman → garlic/amulets 1.25, priest → ritual-prep 1.5…)
   × health/100 × (1 − fear/200). Sick, terrified-at-night, dead and returned villagers do not
   work.
7. Village repair (`village-repair`, 0–100, −3 per dawn) scales night cold at home without fire
   by `1.5 − repair/200`.

Events: `task/assigned`, `task/completed {villager, task, batches}`, `task/delivered {items}`,
`task/stalled {villager, task, item}`, `task/interrupted {villager, task, cause}`.
