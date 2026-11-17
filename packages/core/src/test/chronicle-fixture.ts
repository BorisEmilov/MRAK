/**
 * The fear fixture plus the long-term systems: village growth, a building with a blood price, a
 * festival rite, the lineage rules and two Bloodline nodes.
 */
import { validatePack } from '@mrak/content-schema';
import { ContentDatabase } from '../content/database';
import { cloneState } from '../state/world-state';
import { fearRaw } from './fear-fixture';

type Entity = Record<string, unknown> & { id: string };
const raw = cloneState(fearRaw);
const texts = raw.locales.en.data;
const t = (key: string): string => {
  texts[key] = `[${key}]`;
  return key;
};
const reg = raw.registry.data;
const c = raw.collections as unknown as Record<string, { file: string; data: Entity[] }[]>;
const first = (name: string): Entity => {
  const data: unknown = c[name]?.[0]?.data;
  const e = (Array.isArray(data) ? data[0] : data) as Entity | undefined;
  if (!e) throw new Error(`fixture has no ${name}`);
  return e;
};
const add = (name: string, data: Entity[]): void => {
  (c[name] ??= []).push({ file: `chronicle-${name}.json`, data });
};

reg['stats']?.push(
  { id: 'generation', scope: 'world', min: 1, max: 99, default: 1, description: 'Test.' } as never,
  {
    id: 'prosperity-score',
    scope: 'village',
    min: 0,
    max: 500,
    default: 0,
    description: 'Test.',
  } as never,
);
reg['flags']?.push({ id: 'hall-blessed', description: 'Test flag.' } as never);
reg['rules']?.push(
  { id: 'construction-labour', description: 'Test rule.', params: ['days'] } as never,
  { id: 'surface-possessions', description: 'Test rule.' } as never,
  { id: 'restless-dead', description: 'Test rule.' } as never,
  { id: 'start-with-watchtower', description: 'Test rule.' } as never,
);

if (!c['items']?.some((f) => f.data.some((i) => i.id === 'red-thread')))
  add('items', [
    {
      id: 'red-thread',
      tier: 'demo',
      category: 'material',
      icon: 'item.red-thread',
      stackSize: 20,
      tags: [],
      nameKey: t('item.red-thread.name'),
      descKey: t('item.red-thread.desc'),
    },
  ]);

add('debt-sources', [
  {
    id: 'inherited-pact',
    tier: 'demo',
    nameKey: t('debt.inherited-pact'),
    creditor: 'horned-one',
    kind: 'pact',
    amount: 10,
  },
]);
add('tasks', [
  {
    id: 'construction',
    tier: 'demo',
    nameKey: t('task.construction.name'),
    descKey: t('task.construction.desc'),
    icon: 'task.repairs',
    slot: 'day',
    hours: 8,
    place: 'woodpile',
    output: [{ rule: 'construction-labour', params: { days: 1 } }],
  },
]);
add('buildings', [
  {
    id: 'hall',
    tier: 'demo',
    nameKey: t('building.hall.name'),
    descKey: t('building.hall.desc'),
    poi: 'well',
    levels: [
      {
        level: 1,
        descKey: t('building.hall.level-1'),
        cost: { materials: [{ item: 'firewood', qty: 5 }], labourDays: 2 },
        prosperity: 90,
        effects: [{ modifier: { statBonus: 'sanity-max', value: 5 } }],
      },
      {
        level: 2,
        descKey: t('building.hall.level-2'),
        cost: { materials: [{ item: 'firewood', qty: 5 }], labourDays: 0 },
        minProsperity: 2,
        blood: 'immured-shadow',
        effects: [{ setFlag: 'hall-blessed' }],
      },
    ],
  },
]);
add('bloodline-nodes', [
  {
    id: 'steady-blood',
    tier: 'demo',
    nameKey: t('bloodline.steady-blood.name'),
    descKey: t('bloodline.steady-blood.desc'),
    level: 1,
    cost: 5,
    effects: [{ modifier: { statBonus: 'sanity-max', value: 5 } }],
  },
  {
    id: 'family-tea',
    tier: 'demo',
    nameKey: t('bloodline.family-tea.name'),
    descKey: t('bloodline.family-tea.desc'),
    level: 2,
    cost: 8,
    requires: ['steady-blood'],
    effects: [{ giveItem: 'tea', qty: 2 }],
  },
]);

const unclean = c['festivals']?.[0]?.data.find((f) => f.id === 'unclean-days');
if (!unclean) throw new Error('fixture has no unclean-days');
Object.assign(unclean, {
  rules: [{ modifier: { multiply: 'creature-strength-rate', factor: 1.5 } }],
  rites: [
    {
      id: 'crosses',
      nameKey: t('rite.crosses.name'),
      descKey: t('rite.crosses.desc'),
      options: [
        {
          id: 'draw',
          labelKey: t('rite.crosses.draw'),
          check: { skill: 'investigation', difficulty: 'easy' },
          effects: [{ setFlag: 'hall-blessed' }],
          failEffects: [{ addStat: 'corruption', value: 1 }],
        },
        {
          id: 'skip',
          labelKey: t('rite.crosses.skip'),
          effects: [{ addStat: 'corruption', value: 2 }],
        },
      ],
    },
  ],
  onEnd: [{ milestone: 'night-survived' }],
});

const names = ['a', 'b', 'c', 'd'];
Object.assign(first('village-rules'), {
  growth: {
    constructionTask: 'construction',
    prosperityLevels: [0, 80, 180, 300, 420],
    levelEffects: [{ level: 2, effects: [{ setFlag: 'seed-sown' }] }],
    prosperity: {
      perResident: 1.5,
      chapterObserved: 10,
      death: 4,
      lynching: 20,
      debtCollected: 5,
      decayPerYear: 12,
    },
    population: {
      adultAge: 16,
      elderAge: 55,
      maxAge: 92,
      oldAgeDeath: 0.02,
      marriageChance: 0.35,
      birthChance: 0.3,
      outsiderChance: [1, 1, 1, 1, 1],
      flightChance: 0.08,
      cap: 150,
    },
    names: {
      female: names.map((n) => t(`name.f-${n}`)),
      male: names.map((n) => t(`name.m-${n}`)),
    },
    trades: [t('trade.weaver')],
    secrets: [{ id: 'old-feud', descKey: t('secret.old-feud') }],
  },
});
Object.assign(first('progression-rules'), {
  lineage: {
    guardianStartAge: 25,
    heirAge: 16,
    retireAge: 50,
    apprenticeMinAge: 10,
    maxChildren: 3,
    childChance: 0.4,
    inheritedPactDebt: 'inherited-pact',
    legacy: { perRevelation: 25, chapter: 5, mystery: 3, building: 2, route: 5, year: 1 },
  },
});

// The Endless Chronicle and live seasons.
reg['stats']?.push({
  id: 'creature-cunning-rate',
  scope: 'world',
  min: 0.1,
  max: 10,
  default: 1,
  description: 'Test.',
} as never);
add(
  'darkness-levels',
  [1, 2, 3].map((level) => ({
    id: `darkness-${String(level)}`,
    tier: 'demo',
    nameKey: t(`darkness.${String(level)}.name`),
    descKey: t(`darkness.${String(level)}.desc`),
    level,
    legacyMultiplier: 1 + 0.1 * level,
    effects: [
      { modifier: { multiply: 'creature-strength-rate', factor: 1 + 0.1 * level } },
      { modifier: { multiply: 'creature-cunning-rate', factor: 1 + 0.1 * level } },
    ],
  })),
);
add(
  'seasonal-events',
  [
    ['kukeri-bells', '02-01', '02-28', 'unclean-days'],
    ['unclean-nights', '12-25', '01-06', 'unclean-days'],
  ].map(([id = '', start = '', end = '', festival = '']) => ({
    id,
    tier: 'demo',
    nameKey: t(`seasonal.${id}.name`),
    descKey: t(`seasonal.${id}.desc`),
    window: { start, end },
    entitlement: 'free',
    festival,
    effects: [{ addStat: 'faith', value: 1 }],
    legacy: 3,
  })),
);
const clue = (id: string, about: string, place?: boolean) => ({
  id,
  nameKey: t(`endless.clue.${id}.name`),
  descKey: t(`endless.clue.${id}.desc`),
  reliability: 'solid',
  about,
  ...(place ? { place: { zone: 'village', poi: 'well' } } : {}),
});
Object.assign(first('fear-rules'), {
  endless: {
    maxDarkness: 3,
    mysteries: [
      {
        id: 'spoiled-milk',
        nameKey: t('endless.spoiled-milk.name'),
        questionKey: t('endless.spoiled-milk.question'),
        suspects: 2,
        whyGuiltyKey: t('endless.spoiled-milk.guilty'),
        whyInnocentKey: t('endless.spoiled-milk.innocent'),
        causes: [{ id: 'evil-eye', nameKey: t('endless.cause.evil-eye') }],
        remedies: [{ id: 'confront', nameKey: t('endless.remedy.confront'), action: 'confront' }],
        solution: { cause: 'evil-eye', remedy: 'confront' },
        clues: [
          clue('seen', 'culprit'),
          clue('pail', 'culprit', true),
          clue('alibi', 'innocent'),
          clue('eye', 'cause', true),
          clue('lie', 'liar'),
        ],
        deadlineNight: 12,
        right: { descKey: t('endless.right'), effects: [{ addStat: 'faith', value: 2 }] },
        wrong: { descKey: t('endless.wrong'), effects: [{ addStat: 'corruption', value: 2 }] },
        unsolved: { descKey: t('endless.unsolved'), effects: [{ addStat: 'hysteria', value: 2 }] },
      },
    ],
    possessions: { maxRank: 1, perYear: { min: 0, max: 1 }, combineFrom: 2 },
    harvests: [
      {
        id: 'good-harvest',
        nameKey: t('harvest.good'),
        weight: 3,
        effects: [{ giveItem: 'bread', qty: 20, to: 'storage' }],
      },
      {
        id: 'blight',
        nameKey: t('harvest.blight'),
        weight: 1,
        minDarkness: 1,
        effects: [{ addStat: 'hysteria', value: 3 }],
      },
    ],
    goals: [
      {
        id: 'ten-years',
        category: 'lineage',
        nameKey: t('goal.ten-years'),
        metric: 'endless-years',
        target: 10,
        legacy: 5,
      },
      {
        id: 'big-village',
        category: 'village',
        nameKey: t('goal.big-village'),
        metric: 'population',
        target: 30,
      },
      {
        id: 'collector',
        category: 'collection',
        nameKey: t('goal.collector'),
        metric: 'collection-found',
        target: 5,
      },
    ],
    relics: [{ id: 'calm-relic', darkness: 2, tree: 'exorcist', cell: 'B1', talent: 't-strong' }],
  },
});

const result = validatePack(raw);
if (!result.ok) {
  throw new Error(
    `chronicle fixture is invalid:\n${result.issues.map((i) => `${i.code} ${i.entity ?? ''} ${i.path ?? ''}: ${i.message}`).join('\n')}`,
  );
}

export const chronicleDb = new ContentDatabase(result.pack, {
  version: '0.1.0',
  hash: 'chronicle-test',
});
export const chroniclePack = result.pack;
