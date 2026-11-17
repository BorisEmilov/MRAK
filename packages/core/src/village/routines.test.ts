import { describe, expect, it } from 'vitest';
import { Game } from '../game';
import { fixtureDb } from '../test/fixture';
import { julianToJdn } from '../time/calendar';
import { evaluatorAt, villageRules, weekday } from './common';
import { blockAt, villagerActivity } from './routines';

const rules = villageRules(fixtureDb);
if (!rules) throw new Error('fixture has no village rules');
const velika = fixtureDb.get('villagers', 'velika');
const todor = fixtureDb.get('villagers', 'todor');
const hm = (h: number, m = 0): number => h * 60 + m;

/** A weekday (not Sunday) and a Sunday in January 1835 (after the Unclean Days). */
const START = julianToJdn({ year: 1835, month: 1, day: 10 });
const WEEKDAY = [0, 1, 2, 3, 4, 5, 6].map((i) => START + i).find((d) => weekday(d) === 3) ?? START;
const SUNDAY = [0, 1, 2, 3, 4, 5, 6].map((i) => START + i).find((d) => weekday(d) === 0) ?? START;

function game(): Game {
  return Game.newGame(
    { content: fixtureDb, seed: 3 },
    { start: { year: 1835, month: 1, day: 10 }, startMinute: hm(8) },
  );
}

function activity(g: Game, who = velika, day = WEEKDAY, minute = hm(9)) {
  const s = g.snapshot();
  if (!rules) throw new Error('no rules');
  return villagerActivity(
    s,
    fixtureDb,
    rules,
    who,
    day,
    minute,
    evaluatorAt(s, fixtureDb, day, minute),
  );
}

describe('routine blocks', () => {
  it('the last block whose time has passed is in force, wrapping past midnight', () => {
    const routine = fixtureDb.get('routines', 'common');
    expect(blockAt(routine, hm(0)).activity).toBe('sleep');
    expect(blockAt(routine, hm(7, 29)).activity).toBe('eat');
    expect(blockAt(routine, hm(7, 30)).activity).toBe('work');
    expect(blockAt(routine, hm(23, 59)).activity).toBe('sleep');
  });

  it('weekday(): 1 Jan 2000 (Gregorian) was a Saturday', () => {
    expect(weekday(2451545)).toBe(6);
  });
});

describe('a villager’s day', () => {
  it('follows the routine: home, work, tavern, home', () => {
    const g = game();
    const at = (h: number, m = 0) => activity(g, velika, WEEKDAY, hm(h, m));
    expect(at(3)).toMatchObject({ activity: 'sleep', place: 'house-velika', routine: 'common' });
    expect(at(7)).toMatchObject({ activity: 'eat', place: 'house-velika' });
    expect(at(9)).toMatchObject({ activity: 'work', place: 'house-velika' });
    expect(activity(g, todor, WEEKDAY, hm(9))).toMatchObject({ activity: 'work', place: 'church' });
    expect(at(18)).toMatchObject({ activity: 'socialize', place: 'tavern' });
    expect(at(22)).toMatchObject({ activity: 'sleep', place: 'house-velika' });
  });

  it('a day task sends them to the task’s place during work blocks only', () => {
    const g = game();
    expect(
      g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'day', task: 'firewood' }).ok,
    ).toBe(true);
    expect(activity(g, velika, WEEKDAY, hm(9))).toMatchObject({
      activity: 'task',
      place: 'woodpile',
      task: 'firewood',
    });
    expect(activity(g, velika, WEEKDAY, hm(12, 10))).toMatchObject({ activity: 'eat' });
    g.dispatch({ type: 'assignTask', villager: 'velika', slot: 'day', task: 'amulets' });
    expect(activity(g, velika, WEEKDAY, hm(9))).toMatchObject({
      place: 'house-velika',
      task: 'amulets',
    });
  });

  it('a night task holds them at its post through the night phase', () => {
    const g = game();
    g.dispatch({ type: 'assignTask', villager: 'todor', slot: 'night', task: 'watch' });
    expect(activity(g, todor, WEEKDAY, hm(23))).toMatchObject({
      activity: 'task',
      place: 'bonfire',
    });
    expect(activity(g, todor, WEEKDAY, hm(18))).toMatchObject({ activity: 'socialize' });
  });

  it('Sunday liturgy overrides the morning only', () => {
    const g = game();
    expect(activity(g, velika, SUNDAY, hm(8))).toMatchObject({
      activity: 'pray',
      place: 'church',
      routine: 'sunday',
    });
    expect(activity(g, velika, SUNDAY, hm(11))).toMatchObject({
      activity: 'socialize',
      place: 'well',
    });
    expect(activity(g, velika, SUNDAY, hm(14))).toMatchObject({
      activity: 'work',
      routine: 'common',
    });
  });

  it('an event override (flag) applies only to the villagers it lists', () => {
    const g = game();
    g.dispatch({ type: 'applyEffects', effects: [{ setFlag: 'a' }] });
    expect(activity(g, velika)).toMatchObject({
      activity: 'pray',
      place: 'cemetery',
      routine: 'mourning',
    });
    expect(activity(g, todor)).toMatchObject({ routine: 'common' });
  });

  it('terror sends them home to hide; sickness to bed', () => {
    const g = game();
    g.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'fear', villager: 'velika', value: 90 }],
    });
    expect(activity(g, velika, WEEKDAY, hm(18))).toMatchObject({
      activity: 'hide',
      place: 'house-velika',
    });
    expect(activity(g, velika, WEEKDAY, hm(23))).toMatchObject({ activity: 'hide' });
    expect(activity(g, velika, WEEKDAY, hm(9))).toMatchObject({ activity: 'work' });
    g.dispatch({
      type: 'applyEffects',
      effects: [{ setStat: 'health', villager: 'todor', value: 30 }],
    });
    g.dispatch({ type: 'advanceTime', minutes: 60 });
    expect(g.snapshot().villagers['todor']?.status).toBe('sick');
    expect(activity(g, todor, WEEKDAY, hm(9))).toMatchObject({
      activity: 'rest',
      place: 'house-todor',
    });
  });

  it('a hidden possession avoids the church and sleepwalks to the well', () => {
    const g = game();
    g.dispatch({
      type: 'applyEffects',
      effects: [{ startPossession: 'lesser-bes', host: 'velika' }],
    });
    expect(activity(g, velika, SUNDAY, hm(8))).toMatchObject({
      activity: 'wander',
      place: 'cemetery',
    });
    expect(activity(g, velika, WEEKDAY, hm(2, 30))).toMatchObject({
      activity: 'sleepwalk',
      place: 'well',
    });
    expect(activity(g, velika, WEEKDAY, hm(3, 30))).toMatchObject({ activity: 'sleep' });
  });
});
