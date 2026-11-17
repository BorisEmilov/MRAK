/**
 * Minimal content pack for core tests. It goes through the real validator, so tests can never
 * run against content the game would reject.
 */
import { validatePack, type RawPack } from '@mrak/content-schema';
import { ContentDatabase } from '../content/database';

const stat = (id: string, scope: string, min: number, max: number, def: number) => ({
  id,
  scope,
  min,
  max,
  default: def,
  description: `Test stat ${id}.`,
});

const texts: Record<string, string> = {};
const t = (key: string): string => {
  texts[key] = `[${key}]`;
  return key;
};
const named = (area: string, id: string) => ({
  nameKey: t(`${area}.${id}.name`),
  descKey: t(`${area}.${id}.desc`),
});

const collections: RawPack['collections'] = {
  attributes: [
    {
      file: 'attributes.json',
      data: ['vigor', 'wits', 'cunning', 'resolve', 'presence'].map((id) => ({
        id,
        tier: 'demo',
        ...named('attribute', id),
      })),
    },
  ],
  skills: [
    {
      file: 'skills.json',
      data: [
        ['craft', 'cunning'],
        ['occultism', 'cunning'],
        ['faith', 'resolve'],
        ['investigation', 'wits'],
        ['herbalism', 'wits'],
        ['persuasion', 'presence'],
      ].map(([id = '', attribute]) => ({ id, tier: 'demo', attribute, ...named('skill', id) })),
    },
  ],
  virtues: [
    {
      file: 'virtues.json',
      data: ['mercy', 'patience'].map((id) => ({ id, tier: 'demo', ...named('virtue', id) })),
    },
  ],
  sins: [
    {
      file: 'sins.json',
      data: [
        { id: 'wrath', tier: 'demo', ...named('sin', 'wrath'), blocks: ['patience'] },
        { id: 'pride', tier: 'demo', ...named('sin', 'pride') },
      ],
    },
  ],
  callings: [
    {
      file: 'callings.json',
      data: [
        {
          id: 'acolyte',
          tier: 'demo',
          ...named('calling', 'acolyte'),
          attributeBonuses: ['resolve', 'presence'],
          callingSkills: ['faith', 'investigation', 'persuasion'],
          startingRanks: ['faith', 'investigation', 'persuasion'],
          trees: ['exorcist', 'confessor'],
          startingGear: [{ item: 'garlic', qty: 2 }],
          startingEquipment: ['staff', 'cross', 'charm'],
          ability: {
            ...named('calling.acolyte', 'ability'),
            effects: [
              {
                ability: {
                  uses: 1,
                  per: 'night',
                  cooldown: 60,
                  cost: { sanity: 5 },
                  effects: [{ addStat: 'faith', value: 3 }],
                },
              },
            ],
          },
          defaultVirtue: 'mercy',
          defaultSin: 'wrath',
          startingFaith: 55,
        },
        {
          id: 'healer',
          tier: 'demo',
          ...named('calling', 'healer'),
          attributeBonuses: ['wits', 'cunning'],
          callingSkills: ['herbalism', 'occultism', 'craft'],
          startingRanks: ['herbalism', 'occultism', 'craft'],
          trees: ['folk'],
          startingGear: [],
          ability: {
            ...named('calling.healer', 'ability'),
            effects: [{ addStat: 'faith', value: 1 }],
          },
          defaultVirtue: 'patience',
          defaultSin: 'pride',
          startingFaith: 40,
        },
      ],
    },
  ],
  milestones: [
    {
      file: 'milestones.json',
      data: [
        {
          id: 'night-survived',
          tier: 'demo',
          reasonKey: t('milestone.night'),
          amount: 2,
          on: { event: 'time/dawn' },
          repeat: 'always',
        },
        {
          id: 'zone-discovered',
          tier: 'demo',
          reasonKey: t('milestone.zone'),
          amount: 5,
          on: { event: 'world/zoneEntered', match: { firstVisit: true } },
          repeat: 'per-target',
        },
        {
          id: 'truth',
          tier: 'demo',
          reasonKey: t('milestone.truth'),
          amount: 10,
          repeat: 'per-target',
        },
        { id: 'big', tier: 'demo', reasonKey: t('milestone.big'), amount: 100, repeat: 'always' },
        { id: 'pact-signed', tier: 'demo', reasonKey: t('milestone.pact'), amount: 5 },
      ],
    },
  ],
  'progression-rules': [
    {
      file: 'progression-rules.json',
      data: [
        {
          id: 'default',
          tier: 'demo',
          attributes: {
            base: 2,
            playerPoints: 1,
            creationMax: 4,
            cap: 5,
            absoluteMax: 6,
            costPerRating: 10,
            derived: [{ stat: 'sanity-max', attribute: 'resolve', per: 8 }],
          },
          skills: {
            callingCap: 2,
            otherCap: 1,
            maxCap: 5,
            thresholdFactor: 6,
            capCost: 5,
            foreignCapExtra: 5,
            practice: { failure: 2, success: 1, goodOmen: 2, hardBonus: 1, use: 1 },
            repeatMinutes: 10,
            dailyUseCap: 6,
            uses: {
              gather: 'herbalism',
              talk: 'persuasion',
              photograph: 'investigation',
              grind: 'herbalism',
            },
          },
          trees: {
            secondNativeCost: 20,
            foreignAccess: 30,
            foreignPerTalent: 5,
            softCapLifetime: 600,
            softCapFactor: 1.25,
          },
          checks: {
            maxFate: 8,
            difficulty: { easy: 1, average: 2, hard: 3, daunting: 4, dire: 5 },
            lowSanity: { below: 50, shadow: 1 },
            veryLowSanity: { below: 25, shadow: 2 },
            darkness: 1,
            sacred: -1,
            sacredZones: ['forest'],
            faithCancels: 60,
            corruptionTurns: 50,
            extremeOmen: 3,
          },
          debt: { chancePer5: 0.03, maxChance: 0.6, major: 70, grave: 120, darkScalingMax: 3 },
          virtue: {
            faith: 2,
            boonFate: 1,
            virtuousAfter: 3,
            virtuousFlag: 'virtuous',
            virtuousEffects: [{ modifier: { fateDice: 1, skill: 'faith' } }],
          },
          sin: { corruption: 2, takeoverMax: 0.5, blockAt: 50 },
          notice: {
            learnDemon: 3,
            forbiddenCollectible: 5,
            occultismCheck: 1,
            occultSkills: ['occultism'],
            darkTalent: 2,
            dawnDecay: 1,
            directorDivisor: 50,
          },
          journal: { noteLength: 500, maxNotes: 3 },
          gear: { workshopZone: 'village' },
        },
      ],
    },
  ],
  'talk-tones': [
    {
      file: 'talk-tones.json',
      data: [
        { id: 'plain', tier: 'demo', textKey: t('tone.plain') },
        {
          id: 'listen',
          tier: 'demo',
          textKey: t('tone.listen'),
          tags: ['virtue:patience'],
          affinity: 1,
          order: 1,
        },
        {
          id: 'comfort',
          tier: 'demo',
          textKey: t('tone.comfort'),
          tags: ['virtue:mercy'],
          affinity: 2,
          fear: -5,
          order: 2,
        },
        {
          id: 'press',
          tier: 'demo',
          textKey: t('tone.press'),
          tags: ['sin:wrath'],
          affinity: -2,
          fear: 6,
          order: 3,
        },
        { id: 'vow', tier: 'demo', textKey: t('tone.vow'), noSinTakeover: true, order: 4 },
        { id: 'marked', tier: 'demo', textKey: t('tone.marked'), when: { flag: 'b' }, order: 5 },
      ],
    },
  ],
  'debt-collections': [
    {
      file: 'debt-collections.json',
      data: [
        {
          id: 'dream',
          tier: 'demo',
          creditor: 'horned-one',
          severity: 'minor',
          descKey: t('dc.dream'),
          effects: [{ addStat: 'sanity', value: -10 }],
        },
        {
          id: 'knock',
          tier: 'demo',
          creditor: 'horned-one',
          severity: 'major',
          descKey: t('dc.knock'),
          effects: [{ addStat: 'sanity', value: -20 }],
        },
        {
          id: 'lost',
          tier: 'demo',
          creditor: 'forest-spirit',
          severity: 'minor',
          descKey: t('dc.lost'),
          effects: [{ addStat: 'hysteria', value: 3 }],
        },
      ],
    },
  ],
  'debt-remedies': [
    {
      file: 'debt-remedies.json',
      data: [
        {
          id: 'blood',
          tier: 'demo',
          ...named('remedy', 'blood'),
          creditor: 'horned-one',
          reduce: 3,
          cost: [{ addStat: 'sanity', value: -15 }],
        },
        {
          id: 'gift',
          tier: 'demo',
          ...named('remedy', 'gift'),
          creditor: 'forest-spirit',
          reduce: 4,
          when: { hasItem: 'garlic', qty: 5 },
          cost: [{ takeItem: 'garlic', qty: 5 }],
        },
      ],
    },
  ],
  pacts: [
    {
      file: 'pacts.json',
      data: [
        {
          id: 'bargain',
          tier: 'demo',
          nameKey: t('pact.bargain.name'),
          offerKey: t('pact.bargain.offer'),
          creditor: 'horned-one',
          zone: 'forest',
          window: { from: '23:30', to: '01:00' },
          offerEffects: [{ setFlag: 'b' }, { milestone: 'pact-signed' }],
          visibleTerms: [t('pact.bargain.term')],
          hiddenClauses: [],
          debt: 'pact-minor',
          unlocksTree: 'servant',
          blood: { stat: 'sanity', amount: 5 },
        },
      ],
    },
  ],
  blessings: [
    {
      file: 'blessings.json',
      data: [
        {
          id: 'holy',
          tier: 'demo',
          ...named('blessing', 'holy'),
          origin: 'folklore',
          appliesTo: ['weapon', 'amulet'],
          materials: [{ item: 'garlic', qty: 1 }],
          check: { skill: 'faith', difficulty: 'easy' },
          duration: { uses: 2 },
          power: 'holy',
          effects: [{ modifier: { fateDice: 1, context: 'vs-demon' } }],
        },
        {
          id: 'grave',
          tier: 'demo',
          ...named('blessing', 'grave'),
          origin: 'invented',
          appliesTo: ['weapon'],
          materials: [{ item: 'garlic', qty: 1 }],
          check: { skill: 'occultism', difficulty: 'easy' },
          duration: { nights: 2 },
          power: 'dark',
          effects: [{ modifier: { fateDice: 1, skill: 'occultism' } }],
        },
      ],
    },
  ],
  'omen-tables': [
    {
      file: 'omen-tables.json',
      data: [
        {
          id: 'investigation',
          tier: 'demo',
          context: 'investigation',
          successGood: { descKey: t('omen.sg') },
          successNone: { descKey: t('omen.sn') },
          successBad: { descKey: t('omen.sb'), effects: [{ addStat: 'hysteria', value: 3 }] },
          failureGood: { descKey: t('omen.fg') },
          failureNone: { descKey: t('omen.fn') },
          failureBad: { descKey: t('omen.fb'), effects: [{ addStat: 'notice', value: 3 }] },
          successGreat: { descKey: t('omen.great') },
        },
      ],
    },
  ],
  items: [
    {
      file: 'items.json',
      data: [
        {
          id: 'garlic',
          tier: 'demo',
          category: 'herb',
          icon: 'item.garlic',
          stackSize: 20,
          weight: 0.5,
          ...named('item', 'garlic'),
        },
        {
          id: 'yarrow',
          tier: 'demo',
          category: 'herb',
          icon: 'item.yarrow',
          stackSize: 5,
          weight: 0.1,
          ...named('item', 'yarrow'),
        },
        ...['bread', 'firewood', 'red-thread', 'amulet', 'incense'].map((id) => ({
          id,
          tier: 'demo',
          category: 'material',
          icon: `item.${id}`,
          stackSize: 99,
          ...named('item', id),
        })),
        {
          id: 'lamp-oil',
          tier: 'demo',
          category: 'consumable',
          icon: 'item.lamp-oil',
          stackSize: 20,
          weight: 0.5,
          ...named('item', 'lamp-oil'),
        },
        {
          id: 'tea',
          tier: 'demo',
          category: 'consumable',
          icon: 'item.calming-tea',
          stackSize: 5,
          useEffects: [{ addStat: 'sanity', value: 10 }],
          ...named('item', 'tea'),
        },
        {
          id: 'stone',
          tier: 'demo',
          category: 'material',
          icon: 'item.iron',
          stackSize: 10,
          slotSize: 2,
          weight: 6,
          ...named('item', 'stone'),
        },
        {
          id: 'camera',
          tier: 'demo',
          category: 'tool',
          icon: 'item.daguerreotype-camera',
          stackSize: 1,
          unique: true,
          weight: 3,
          ...named('item', 'camera'),
        },
        {
          id: 'plate',
          tier: 'demo',
          category: 'consumable',
          icon: 'item.photographic-plate',
          stackSize: 10,
          weight: 0.2,
          ...named('item', 'plate'),
        },
        ...(['coin', 'mirror', 'doll'] as const).map((id) => ({
          id,
          tier: 'demo',
          category: 'relic',
          icon: 'item.zlatno-gold-coin',
          stackSize: 1,
          unique: true,
          weight: 0.1,
          cursed: id,
          ...named('item', id),
        })),
      ],
    },
  ],
  gear: [
    {
      file: 'gear.json',
      data: [
        {
          id: 'lantern',
          tier: 'demo',
          ...named('gear', 'lantern'),
          slot: 'lantern',
          blessingSlots: 1,
          lightRadius: 4,
        },
        {
          id: 'staff',
          tier: 'demo',
          ...named('gear', 'staff'),
          slot: 'weapon',
          blessingSlots: 1,
          upgrades: [
            {
              id: 'iron-tip',
              nameKey: t('gear.staff.iron-tip'),
              materials: [{ item: 'garlic', qty: 1 }],
              blessingSlots: 1,
              effects: [{ modifier: { fateDice: 1, skill: 'craft' } }],
            },
          ],
        },
        {
          id: 'cross',
          tier: 'demo',
          ...named('gear', 'cross'),
          slot: 'amulet',
          blessingSlots: 1,
          effects: [{ modifier: { shadowDice: -1, context: 'vs-demon' } }],
        },
        { id: 'charm', tier: 'demo', ...named('gear', 'charm'), slot: 'amulet', blessingSlots: 0 },
      ],
    },
  ],
  recipes: [
    {
      file: 'recipes.json',
      data: [
        {
          id: 'braid',
          tier: 'demo',
          ...named('recipe', 'braid'),
          inputs: [{ item: 'garlic', qty: 3 }],
          check: { skill: 'craft', difficulty: 'easy' },
          minutes: 30,
          outputs: [{ item: 'garlic', qty: 1 }],
        },
        {
          id: 'brew-tea',
          tier: 'demo',
          ...named('recipe', 'brew-tea'),
          inputs: [{ item: 'yarrow', qty: 2 }],
          check: { skill: 'craft', difficulty: 'easy' },
          minutes: 60,
          outputs: [{ item: 'tea', qty: 1 }],
        },
        {
          id: 'charm',
          tier: 'demo',
          ...named('recipe', 'charm'),
          inputs: [
            { item: 'garlic', qty: 1 },
            { item: 'red-thread', qty: 1 },
          ],
          check: { skill: 'craft', difficulty: 'easy' },
          minutes: 20,
          outputs: [{ item: 'amulet', qty: 1 }],
        },
        {
          id: 'dark-incense',
          tier: 'demo',
          ...named('recipe', 'dark-incense'),
          inputs: [{ item: 'incense', qty: 2 }],
          check: { skill: 'craft', difficulty: 'hard' },
          minutes: 30,
          outputs: [{ item: 'tea', qty: 1 }],
          visibleWhen: { flag: 'witch-allied' },
          onBrew: [{ addStat: 'corruption', value: 3 }],
        },
      ],
    },
  ],
  villagers: [
    {
      file: 'villagers.json',
      data: ['velika', 'todor'].map((id) => ({
        id,
        tier: 'demo',
        nameKey: t(`villager.${id}.name`),
        tradeKey: t(`villager.${id}.trade`),
        bioKey: t(`villager.${id}.bio`),
        age: 20,
        sex: id === 'velika' ? 'female' : 'male',
        fears: id === 'velika' ? ['water', 'solitude'] : ['dark'],
        startingFear: 10,
        relationships: [{ villager: id === 'velika' ? 'todor' : 'velika', affinity: 80 }],
        traits: id === 'velika' ? ['weaver'] : ['educated', 'sexton', 'priest'],
        home: `house-${id}`,
        work: id === 'velika' ? `house-${id}` : 'church',
        routine: 'common',
        look: { skin: '#e2b592', hair: '#5a3418', clothes: '#e8e0cc', accent: '#b02a2a' },
      })),
    },
  ],
  zones: [
    {
      file: 'zones.json',
      data: [
        {
          id: 'village',
          tier: 'demo',
          ...named('zone', 'village'),
          map: 'maps/village.tmj',
          defaultVariant: 'normal',
          variants: [{ id: 'normal', nameKey: t('zone.village.normal') }],
          pois: [
            ...(
              [
                ['house-velika', 'house'],
                ['house-todor', 'house'],
                ['church', 'church'],
                ['tavern', 'tavern'],
                ['well', 'well'],
                ['bonfire', 'bonfire'],
                ['woodpile', 'woodpile'],
                ['cemetery', 'cemetery'],
              ] as const
            ).map(([id, kind]) => ({
              id,
              kind,
              nameKey: t(`zone.village.poi.${id}`),
              action: 'use',
            })),
            {
              id: 'garden',
              kind: 'herbs',
              nameKey: t('zone.village.poi.garden'),
              action: 'gather',
              once: false,
              gather: { item: 'garlic', qty: 1, regrowDays: 0 },
            },
          ],
        },
        {
          id: 'forest',
          tier: 'demo',
          ...named('zone', 'forest'),
          map: 'maps/forest.tmj',
          defaultVariant: 'wild',
          variants: [
            { id: 'hostile', nameKey: t('zone.forest.hostile'), when: { flag: 'witch-allied' } },
            { id: 'burned', nameKey: t('zone.forest.burned') },
            { id: 'wild', nameKey: t('zone.forest.wild') },
          ],
          pois: [
            {
              id: 'meadow',
              kind: 'herbs',
              nameKey: t('zone.forest.poi.meadow'),
              action: 'gather',
              once: false,
              gather: {
                item: 'yarrow',
                qty: 2,
                regrowDays: 3,
                when: { date: { from: '06-01', to: '07-31' } },
              },
            },
            {
              id: 'moonwort',
              kind: 'herbs',
              nameKey: t('zone.forest.poi.moonwort'),
              action: 'gather',
              once: false,
              gather: { item: 'garlic', qty: 1, regrowDays: 1, when: { moon: ['full'] } },
            },
            {
              id: 'oil-cache',
              kind: 'oil-store',
              nameKey: t('zone.forest.poi.oil-cache'),
              action: 'gather',
              effects: [{ giveItem: 'lamp-oil', qty: 2 }],
            },
            {
              id: 'well',
              kind: 'well',
              nameKey: t('zone.forest.poi.well'),
              action: 'use',
              effects: [{ addStat: 'sanity', value: 1 }],
              once: false,
            },
          ],
          // edge ─ village ═ clearing ═ oak ─ deep, with a shifting pair and conditional paths.
          paths: {
            nodes: [{ id: 'edge', exit: true }, { id: 'clearing' }, { id: 'oak' }, { id: 'deep' }],
            edges: [
              { id: 'e-main', from: 'edge', to: 'clearing' },
              { id: 'e-left', from: 'clearing', to: 'oak', shift: 'g1' },
              { id: 'e-right', from: 'edge', to: 'oak', shift: 'g1' },
              { id: 'e-loop', from: 'clearing', to: 'deep', shift: 'g2' },
              { id: 'e-dead', from: 'oak', to: 'clearing', shift: 'g2' },
              { id: 'e-night', from: 'oak', to: 'deep', when: { phase: 'night' } },
              {
                id: 'e-corrupt',
                from: 'edge',
                to: 'deep',
                when: { stat: 'corruption', '>=': 50 },
              },
            ],
          },
        },
      ],
    },
  ],
  traits: [
    {
      file: 'traits.json',
      data: [
        { id: 'weaver', taskEfficiency: { amulets: 1.5 } },
        { id: 'educated', taskEfficiency: { watch: 1.25, firewood: 0.75 } },
        { id: 'sexton' },
        { id: 'priest', spread: 0.5 },
      ].map((tr) => ({ tier: 'demo', ...named('trait', tr.id), ...tr })),
    },
  ],
  tasks: [
    {
      file: 'tasks.json',
      data: [
        {
          id: 'firewood',
          icon: 'task.firewood',
          slot: 'day',
          hours: 4,
          place: 'woodpile',
          output: [{ giveItem: 'firewood', qty: 4 }],
        },
        {
          id: 'amulets',
          icon: 'task.amulets',
          slot: 'day',
          hours: 4,
          place: 'home',
          consumes: [{ item: 'red-thread', qty: 1 }],
          output: [{ giveItem: 'amulet', qty: 1 }],
        },
        {
          id: 'food',
          icon: 'task.food',
          slot: 'day',
          hours: 3,
          place: 'tavern',
          output: [{ giveItem: 'bread', qty: 3 }],
        },
        {
          id: 'watch',
          icon: 'task.watch',
          slot: 'night',
          hours: 10,
          place: 'bonfire',
          consumes: [{ item: 'lamp-oil', qty: 1 }],
          defence: 10,
        },
      ].map((task) => ({ tier: 'demo', ...named('task', task.id), ...task })),
    },
  ],
  routines: [
    {
      file: 'routines.json',
      data: [
        {
          id: 'common',
          tier: 'demo',
          nameKey: t('routine.common.name'),
          blocks: [
            { at: '00:00', activity: 'sleep', place: 'home' },
            { at: '06:00', activity: 'chores', place: 'home' },
            { at: '07:00', activity: 'eat', place: 'home' },
            { at: '07:30', activity: 'work', place: 'work' },
            { at: '12:00', activity: 'eat', place: 'work' },
            { at: '12:30', activity: 'work', place: 'work' },
            { at: '17:30', activity: 'socialize', place: 'tavern' },
            { at: '19:00', activity: 'eat', place: 'home' },
            { at: '20:00', activity: 'rest', place: 'home' },
            { at: '21:30', activity: 'sleep', place: 'home' },
          ],
        },
        {
          id: 'sunday',
          tier: 'demo',
          nameKey: t('routine.sunday.name'),
          priority: 10,
          days: [0],
          window: { from: '07:30', to: '13:00' },
          blocks: [
            { at: '07:30', activity: 'pray', place: 'church' },
            { at: '10:30', activity: 'socialize', place: 'well' },
          ],
        },
        {
          id: 'mourning',
          tier: 'demo',
          nameKey: t('routine.mourning.name'),
          priority: 20,
          when: { flag: 'a' },
          villagers: ['velika'],
          blocks: [{ at: '00:00', activity: 'pray', place: 'cemetery' }],
        },
      ],
    },
  ],
  'village-rules': [
    {
      file: 'village-rules.json',
      data: [
        {
          id: 'default',
          tier: 'demo',
          zone: 'village',
          fear: {
            contagionRate: 0.02,
            contagionCap: 5,
            proximityWeight: 0.25,
            faithDamping: 0.5,
            tagMultiplier: 1.5,
            needFearPerHour: 1,
            darkFearPerHour: 1,
            solitudeFearPerHour: 1,
            deathOfCloseRelation: 25,
            deathInVillage: 5,
            closeAffinity: 50,
            returnedSighting: 10,
            decayPerDawn: 5,
            decayWhenHysterical: 3,
            hysteriaThreshold: 60,
            terrifiedAt: 80,
            calmBelow: 60,
            panicAt: 100,
            nightTaskMaxFear: 80,
            maskedFactor: 0.3,
          },
          needs: {
            hungerPerHour: 3,
            mealRelief: 45,
            mealItem: 'bread',
            portionsPerItem: 4,
            coldReliefByDay: 4,
            coldPerNightHour: { winter: 6, spring: 2, summer: 0, autumn: 3 },
            warmthAtHome: 6,
            unheatedFactor: 0.5,
            firewoodItem: 'firewood',
            firewoodPerHome: 1,
            faithDecayPerDay: 2,
            prayFaithPerHour: 6,
            threshold: 70,
          },
          health: {
            lossPerHour: 3,
            critical: 90,
            regenPerHour: 0.5,
            sickBelow: 50,
            recoveredAt: 75,
          },
          tasks: {
            carryOver: 0.5,
            repairStat: 'village-repair',
            repairDecayPerDawn: 3,
            watchStat: 'night-watch',
          },
          death: {
            unquietCauses: ['violence'],
            returnAfterNights: 1,
            sextonTrait: 'sexton',
            priestTrait: 'priest',
            riteItems: [{ item: 'incense', qty: 1 }],
            layToRestItems: [{ item: 'garlic', qty: 2 }],
            returnedSanityHit: 8,
            grave: 'cemetery',
          },
          possession: { sleepwalkPlace: 'well', sleepwalkFrom: '02:00', sleepwalkTo: '03:00' },
        },
      ],
    },
  ],
  'cursed-objects': [
    {
      file: 'cursed.json',
      data: [
        {
          id: 'coin',
          whisper: 1,
          carried: [{ statBonus: 'notice', value: 5 }],
          displayed: [{ statBonus: 'sanity-max', value: 2 }],
          effects: [{ setFlag: 'b' }],
          memoryScene: 'memory-coin',
          memoryEffects: [{ addStat: 'notice', value: 1 }],
        },
        { id: 'mirror', whisper: 0, displayed: [{ statBonus: 'sanity-max', value: 3 }] },
        { id: 'doll', whisper: 2 },
      ].map((c) => ({
        tier: 'demo',
        ...named('cursed-object', c.id),
        memoryKey: t(`cursed-object.${c.id}.memory`),
        ...c,
      })),
    },
  ],
  'cabinet-sets': [
    {
      file: 'sets.json',
      data: [
        {
          id: 'pair',
          tier: 'demo',
          ...named('cabinet-set', 'pair'),
          objects: ['coin', 'mirror'],
          modifiers: [{ statBonus: 'sanity-max', value: 10 }],
        },
      ],
    },
  ],
  'photo-layers': [
    {
      file: 'layers.json',
      data: [
        { id: 'second-face', kind: 'possessed', target: { villager: '*', possessed: true } },
        {
          id: 'bes-mark',
          kind: 'possessed',
          target: { villager: '*', possessed: 'lesser-bes' },
          effects: [{ addClue: 'c-witness' }],
        },
        { id: 'well-sign', kind: 'symbol', target: { zone: 'village', poi: 'well' } },
        {
          id: 'forest-ghosts',
          kind: 'presence',
          target: { zone: 'forest' },
          when: { phase: 'night' },
        },
      ].map((l) => ({ tier: 'demo', ...named('photo-layer', l.id), ...l })),
    },
  ],
  'item-rules': [
    {
      file: 'item-rules.json',
      data: [
        {
          id: 'default',
          tier: 'demo',
          inventory: {
            homeZone: 'village',
            packSlots: 4,
            carryWeight: 10,
            encumberedSpeed: 0.6,
            groundStacks: 4,
            potencyScale: [1, 1.5, 2],
            slotsStat: 'pack-slots',
            weightStat: 'carry-weight',
            whisperStat: 'sanity',
          },
          gathering: {
            boosts: [
              { when: { phase: 'dawn' }, add: 1, labelKey: t('gather.boost.dawn') },
              {
                when: { date: { from: '06-24', to: '06-24' } },
                factor: 2,
                labelKey: t('gather.boost.enyovden'),
              },
            ],
          },
          alchemy: { failMinutes: 15, maxIngredients: 4, maxQty: 5, journalSize: 10 },
          talk: { affinityPerDay: 2 },
          cabinet: { slots: 2 },
          photography: {
            camera: 'camera',
            plate: 'plate',
            minutes: 10,
            albumSize: 3,
            rangeTiles: 4,
          },
        },
      ],
    },
  ],
  starts: [
    {
      file: 'starts.json',
      data: [
        {
          id: 'default',
          tier: 'demo',
          zone: 'forest',
          lantern: 'lantern',
          effects: [{ giveItem: 'lamp-oil', qty: 4 }],
        },
      ],
    },
  ],
  festivals: [
    {
      file: 'festivals.json',
      data: [
        {
          id: 'unclean-days',
          tier: 'demo',
          ...named('festival', 'unclean-days'),
          origin: 'folklore',
          start: { fixed: { month: 12, day: 25 } },
          nights: 12,
        },
        {
          id: 'rusalia',
          tier: 'full',
          ...named('festival', 'rusalia'),
          origin: 'folklore',
          // The week after Pentecost (Easter + 49): Monday = Easter + 50.
          start: { easterOffsetDays: 50 },
          nights: 7,
        },
      ],
    },
  ],
  'debt-sources': [
    {
      file: 'debt.json',
      data: [
        {
          id: 'devils-luck',
          tier: 'demo',
          nameKey: t('debt.devils-luck'),
          creditor: 'horned-one',
          kind: 'talent',
          amount: 2,
        },
        {
          id: 'pact-minor',
          tier: 'demo',
          nameKey: t('debt.pact-minor'),
          creditor: 'horned-one',
          kind: 'pact',
          amount: 5,
        },
        {
          id: 'dark-talent',
          tier: 'demo',
          nameKey: t('debt.dark-talent'),
          creditor: 'horned-one',
          kind: 'talent',
          amount: 1,
        },
        {
          id: 'favour',
          tier: 'demo',
          nameKey: t('debt.favour'),
          creditor: 'forest-spirit',
          kind: 'favour',
          amount: 6,
        },
      ],
    },
  ],
  demons: [
    {
      file: 'demons.json',
      data: [
        {
          id: 'lesser-bes',
          tier: 'demo',
          nameKey: t('demon.lesser-bes.name'),
          epithetKey: t('demon.lesser-bes.epithet'),
          trueNameKey: t('demon.lesser-bes.true-name'),
          loreKey: t('demon.lesser-bes.lore'),
          rank: 1,
          origin: 'folklore',
          seal: null,
          symptoms: [1, 2, 3].map((stage) => ({
            stage,
            descKey: t(`demon.lesser-bes.s${String(stage)}`),
          })),
          weaknesses: [{ descKey: t('demon.lesser-bes.w1'), item: 'garlic' }],
          desires: [t('demon.lesser-bes.d1')],
          maxStage: 3,
          phrases: [t('demon.lesser-bes.p1')],
          taunts: Object.fromEntries(
            ['pact', 'sacrifice', 'death', 'lynching', 'debt'].map((k) => [
              k,
              t(`demon.lesser-bes.taunt.${k}`),
            ]),
          ),
          fragments: ['grave', 'confession'].map((id) => ({
            id,
            source: id,
            textKey: t(`demon.lesser-bes.fragment.${id}`),
          })),
        },
      ],
    },
  ],
  events: [
    {
      file: 'events.json',
      data: [
        {
          id: 'knock',
          tier: 'demo',
          nameKey: t('event.knock.name'),
          textKey: t('event.knock.text'),
          category: 'set-piece',
          weight: 1,
          cooldownMinutes: 0,
          tensionCost: 0,
          effects: [{ setFlag: 'ev-fired' }],
        },
        {
          id: 'loop',
          tier: 'demo',
          nameKey: t('event.loop.name'),
          textKey: t('event.loop.text'),
          category: 'set-piece',
          weight: 1,
          cooldownMinutes: 0,
          tensionCost: 0,
          effects: [{ triggerEvent: 'loop' }],
        },
      ],
    },
  ],
  quests: [
    {
      file: 'quests.json',
      data: [
        {
          id: 'q1',
          tier: 'demo',
          nameKey: t('quest.q1.name'),
          kind: 'chapter',
          stages: [
            {
              id: 's1',
              descKey: t('quest.q1.s1'),
              objectives: [{ id: 'o1', descKey: t('quest.q1.o1'), condition: { flag: 'a' } }],
            },
          ],
        },
        {
          id: 'ally',
          tier: 'demo',
          nameKey: t('quest.ally.name'),
          kind: 'route',
          excludes: ['burn'],
          stages: [
            {
              id: 'ask',
              descKey: t('quest.ally.ask'),
              objectives: [
                {
                  id: 'o',
                  descKey: t('quest.ally.o'),
                  condition: { flag: 'b' },
                  marker: { zone: 'village', poi: 'well' },
                },
              ],
              onComplete: [{ setFlag: 'witch-allied' }],
            },
            {
              id: 'sworn',
              descKey: t('quest.ally.sworn'),
              noReturn: true,
              objectives: [
                { id: 'o2', descKey: t('quest.ally.o2'), condition: { flag: 'ev-fired' } },
              ],
            },
          ],
          failWhen: { flag: 'bridge-burned' },
        },
        {
          id: 'q-auto',
          tier: 'demo',
          nameKey: t('quest.q-auto.name'),
          kind: 'villager',
          startWhen: { flag: 'moon-pulled-down' },
          stages: [
            {
              id: 's',
              descKey: t('quest.q-auto.s'),
              objectives: [
                { id: 'o', descKey: t('quest.q-auto.o'), condition: { flag: 'witch-allied' } },
              ],
            },
          ],
        },
        {
          id: 'burn',
          tier: 'demo',
          nameKey: t('quest.burn.name'),
          kind: 'route',
          stages: [
            {
              id: 'fire',
              descKey: t('quest.burn.fire'),
              objectives: [{ id: 'o', descKey: t('quest.burn.o'), condition: { flag: 'a' } }],
            },
          ],
        },
      ],
    },
  ],
  collectibles: [
    {
      file: 'collectibles.json',
      data: [
        {
          id: 'page',
          tier: 'demo',
          ...named('collectible', 'page'),
          kind: 'grimoire-page',
          origin: 'invented',
          journalPages: 1,
          grants: [{ addClue: 'c-ledger' }],
        },
        {
          id: 'song-velika',
          tier: 'demo',
          ...named('collectible', 'song-velika'),
          kind: 'song',
          origin: 'folklore',
          journalPages: 1,
          source: { talk: 'velika' },
        },
        {
          id: 'song-velika-2',
          tier: 'demo',
          ...named('collectible', 'song-velika-2'),
          kind: 'song',
          origin: 'folklore',
          journalPages: 1,
          source: { talk: 'velika', when: { flag: 'b' } },
        },
        {
          id: 'tale-todor',
          tier: 'demo',
          ...named('collectible', 'tale-todor'),
          kind: 'folk-tale',
          origin: 'folklore',
          journalPages: 1,
          source: { talk: 'todor', minAffinity: 4 },
          grants: [{ setFlag: 'bridge-burned' }],
        },
        {
          id: 'relic',
          tier: 'demo',
          ...named('collectible', 'relic'),
          kind: 'relic',
          origin: 'history',
          journalPages: 1,
        },
      ],
    },
  ],
  mysteries: [
    {
      file: 'mysteries.json',
      data: [
        {
          id: 'm1',
          tier: 'demo',
          nameKey: t('mystery.m1.name'),
          questionKey: t('mystery.m1.q'),
          chapter: 'unclean-days',
          deadlineNight: 12,
          suspects: [
            {
              villager: 'velika',
              whyGuiltyKey: t('m1.velika.g'),
              whyInnocentKey: t('m1.velika.i'),
            },
            { villager: 'todor', whyGuiltyKey: t('m1.todor.g') },
          ],
          causes: [{ id: 'cause-x', nameKey: t('m1.cause') }],
          remedies: [{ id: 'rem-y', nameKey: t('m1.rem') }],
          clues: [
            {
              id: 'c-ledger',
              ...named('clue', 'c-ledger'),
              reliability: 'solid',
              sources: [{ kind: 'collectible', ref: 'page' }],
              supports: ['culprit:todor'],
            },
            {
              id: 'c-witness',
              ...named('clue', 'c-witness'),
              reliability: 'solid',
              sources: [{ kind: 'villager', ref: 'velika' }],
              supports: ['culprit:todor', 'cause:cause-x'],
            },
            {
              id: 'c-alibi',
              ...named('clue', 'c-alibi'),
              reliability: 'solid',
              sources: [{ kind: 'zone', ref: 'forest' }],
              refutes: ['culprit:velika'],
            },
          ],
          solution: { culprit: 'todor', cause: 'cause-x', remedy: 'rem-y' },
          outcomes: [
            { culprit: 'velika', descKey: t('m1.o.v'), effects: [{ setFlag: 'b' }] },
            { culprit: 'todor', descKey: t('m1.o.t'), effects: [{ setFlag: 'a' }] },
          ],
          unsolved: { descKey: t('m1.unsolved'), effects: [{ setFlag: 'b' }] },
        },
      ],
    },
  ],
  talents: [
    {
      file: 'talents.json',
      data: [
        {
          id: 't-grit',
          tier: 'demo',
          ...named('talent', 't-grit'),
          ranked: true,
          effects: [{ modifier: { statBonus: 'sanity-max', value: 5 } }],
        },
        {
          id: 't-litany',
          tier: 'demo',
          ...named('talent', 't-litany'),
          effects: [{ modifier: { fateDice: 1, skill: 'faith' } }],
        },
        {
          id: 't-calm',
          tier: 'demo',
          ...named('talent', 't-calm'),
          effects: [{ modifier: { convertOmen: 'bad-to-none' } }],
        },
        {
          id: 't-strong',
          tier: 'demo',
          ...named('talent', 't-strong'),
          effects: [{ rule: 'attribute-max-6', params: { attribute: 'resolve' } }],
        },
        {
          id: 't-tongue',
          tier: 'demo',
          ...named('talent', 't-tongue'),
          effects: [
            { modifier: { fateDice: 1, skill: 'persuasion', perDebt: 5 } },
            { setFlag: 'b' },
          ],
        },
        {
          id: 't-friend',
          tier: 'demo',
          ...named('talent', 't-friend'),
          effects: [{ rule: 'debt-collection-tier-shift', params: { tiers: -1 } }],
        },
      ],
    },
  ],
  trees: [
    {
      file: 'trees.json',
      data: [
        {
          id: 'pact-tree',
          tier: 'demo',
          ...named('tree', 'pact-tree'),
          kind: 'dark',
          unlock: { flag: 'a' },
          rowCosts: [5],
          rowCorruption: [4],
          columns: 1,
          nodes: [{ cell: 'A1', talent: 't-grit' }],
        },
        {
          id: 'exorcist',
          tier: 'demo',
          ...named('tree', 'exorcist'),
          kind: 'calling',
          calling: 'acolyte',
          rowCosts: [5, 10],
          columns: 2,
          nodes: [
            { cell: 'A1', talent: 't-grit' },
            { cell: 'B1', talent: 't-calm' },
            { cell: 'A2', talent: 't-litany', requires: ['A1'] },
            { cell: 'B2', talent: 't-strong', requires: ['A1', 'B1'] },
          ],
        },
        {
          id: 'confessor',
          tier: 'demo',
          ...named('tree', 'confessor'),
          kind: 'calling',
          calling: 'acolyte',
          rowCosts: [5],
          columns: 1,
          nodes: [{ cell: 'A1', talent: 't-grit' }],
        },
        {
          id: 'folk',
          tier: 'demo',
          ...named('tree', 'folk'),
          kind: 'calling',
          calling: 'healer',
          rowCosts: [5],
          columns: 1,
          nodes: [{ cell: 'A1', talent: 't-calm' }],
        },
        {
          id: 'servant',
          tier: 'demo',
          ...named('tree', 'servant'),
          kind: 'dark',
          unlock: { pactSigned: 'bargain' },
          rowCosts: [5, 10],
          rowCorruption: [4, 6],
          rowDebt: [1, 2],
          debtSource: 'dark-talent',
          columns: 1,
          nodes: [
            { cell: 'A1', talent: 't-tongue' },
            { cell: 'A2', talent: 't-friend', requires: ['A1'] },
          ],
        },
      ],
    },
  ],
};

const raw: RawPack = {
  registry: {
    file: 'flags.json',
    data: {
      flags: [
        'a',
        'b',
        'bridge-burned',
        'witch-allied',
        'ev-fired',
        'moon-pulled-down',
        'virtuous',
      ].map((id) => ({
        id,
        description: `Test flag ${id}.`,
      })),
      stats: [
        stat('corruption', 'guardian', 0, 100, 0),
        stat('faith', 'guardian', 0, 100, 40),
        stat('sanity', 'guardian', 0, 200, 76),
        stat('sanity-max', 'guardian', 0, 200, 76),
        stat('notice', 'guardian', 0, 100, 0),
        stat('pack-slots', 'guardian', 0, 20, 0),
        stat('carry-weight', 'guardian', 0, 100, 0),
        stat('oil-consumption-rate', 'guardian', 0.1, 5, 1),
        stat('debt', 'guardian', 0, 1000, 0),
        stat('hysteria', 'village', 0, 100, 10),
        stat('hysteria-gain-rate', 'village', 0.1, 5, 1),
        stat('fear', 'villager', 0, 100, 10),
        stat('hunger', 'villager', 0, 100, 20),
        stat('cold', 'villager', 0, 100, 10),
        stat('villager-faith', 'villager', 0, 100, 50),
        stat('health', 'villager', 0, 100, 100),
        stat('night-watch', 'village', 0, 500, 0),
        stat('village-repair', 'village', 0, 100, 60),
        stat('night-index', 'world', 0, 14, 0),
        stat('year', 'world', 1700, 2100, 1834),
        stat('nights-survived', 'world', 0, 100000, 0),
        stat('revelation', 'guardian', 0, 100000, 0),
        stat('journal-pages', 'guardian', 0, 200, 2),
        stat('affinity-gain-rate', 'guardian', 0.1, 5, 1),
        stat('debt-collection-rate', 'world', 0.1, 10, 1),
      ],
      rules: [
        { id: 'mark-lies', description: 'Test rule.', params: ['chance'] },
        { id: 'attribute-max-6', description: 'Test rule.', params: ['attribute'] },
        { id: 'debt-collection-tier-shift', description: 'Test rule.', params: ['tiers'] },
      ],
      contexts: [
        { id: 'vs-demon', description: 'Test context.' },
        { id: 'investigation', description: 'Test context.' },
      ],
    },
  },
  locales: { en: { file: 'en.json', data: texts } },
  collections,
};

const result = validatePack(raw);
if (!result.ok) {
  throw new Error(
    `test fixture is invalid:\n${result.issues.map((i) => `${i.code} ${i.entity ?? ''} ${i.path ?? ''}: ${i.message}`).join('\n')}`,
  );
}

/** The raw pack, for fixtures that extend it (test/fear-fixture.ts). */
export const fixtureRaw = raw;
export const fixturePack = result.pack;
export const fixtureDb = new ContentDatabase(result.pack, { version: '0.1.0', hash: 'test' });
