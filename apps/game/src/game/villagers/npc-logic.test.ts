import type { VillagerActivity, VillagerView } from '@mrak/core';
import { ICON_NAMES, type IconName } from '@mrak/ui-kit';
import { describe, expect, it } from 'vitest';
import { loadContentDatabase } from '../../host/content';
import { bubbleIcon, INDOORS } from './npc-logic';

const db = loadContentDatabase();
const taskIcon = (task: string): IconName | null => {
  const icon = db.find('tasks', task)?.icon;
  return icon && (ICON_NAMES as readonly string[]).includes(icon) ? (icon as IconName) : null;
};

const view = (over: Partial<VillagerView> = {}): VillagerView => ({
  id: 'velika',
  alive: true,
  status: 'healthy',
  possessed: false,
  fear: 10,
  hunger: 10,
  cold: 10,
  faith: 50,
  health: 100,
  tasks: { day: null, night: null },
  efficiency: {},
  activity: { activity: 'work', place: 'mill', task: null, routine: 'common' },
  secrets: [],
  death: null,
  affinity: {},
  ...over,
});
const act = (over: Partial<VillagerActivity> = {}): VillagerActivity => ({
  activity: 'work',
  place: 'mill',
  task: null,
  routine: 'common',
  ...over,
});

describe('bubble icons', () => {
  it('every task of the content has a ui-kit icon', () => {
    for (const task of db.all('tasks')) expect(taskIcon(task.id), task.id).not.toBeNull();
  });

  it('shows the most pressing state first', () => {
    expect(bubbleIcon(view({ status: 'sick', fear: 90 }), act(), 1, taskIcon)).toBe(
      'villager-state.sick',
    );
    expect(bubbleIcon(view({ fear: 75, hunger: 90 }), act(), 1, taskIcon)).toBe(
      'villager-state.afraid',
    );
    expect(bubbleIcon(view({ hunger: 90, cold: 90 }), act(), 1, taskIcon)).toBe('need.hunger');
    expect(bubbleIcon(view({ cold: 90 }), act(), 1, taskIcon)).toBe('need.cold');
  });

  it('shows the task only up close, and nothing for the calm and idle', () => {
    const working = act({ activity: 'task', task: 'firewood', place: 'woodpile' });
    expect(bubbleIcon(view(), working, 3, taskIcon)).toBe('task.firewood');
    expect(bubbleIcon(view(), working, 12, taskIcon)).toBeNull();
    expect(bubbleIcon(view(), act({ activity: 'socialize' }), 1, taskIcon)).toBeNull();
    expect(bubbleIcon(view({ alive: false }), act(), 1, taskIcon)).toBeNull();
  });

  it('work is done outdoors; sleep and hiding indoors', () => {
    expect(INDOORS.has('sleep')).toBe(true);
    expect(INDOORS.has('hide')).toBe(true);
    expect(INDOORS.has('task')).toBe(false);
  });
});
