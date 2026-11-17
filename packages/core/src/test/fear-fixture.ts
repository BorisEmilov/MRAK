/**
 * The core fixture plus the fear engine: fear rules, a few director events of each category,
 * suspicion stats and a relic. Validated by the real validator like the base fixture.
 */
import { validatePack, type RawPack } from '@mrak/content-schema';
import { ContentDatabase } from '../content/database';
import { cloneState } from '../state/world-state';
import { fixtureRaw } from './fixture';

const raw = cloneState(fixtureRaw) as RawPack & {
  registry: { data: Record<string, { id: string }[]> };
  locales: { en: { data: Record<string, string> } };
};
const texts = raw.locales.en.data;
const t = (key: string): string => {
  texts[key] = `[${key}]`;
  return key;
};
const reg = raw.registry.data;
const stat = (id: string, scope: string, min: number, max: number, def: number) => ({
  id,
  scope,
  min,
  max,
  default: def,
  description: `Test stat ${id}.`,
});
reg['stats']?.push(
  stat('suspicion', 'villager', 0, 100, 0),
  stat('guardian-suspicion', 'guardian', 0, 100, 0),
  stat('village-corruption', 'village', 0, 100, 0),
  stat('creature-strength-rate', 'world', 0.1, 10, 1),
  stat('guardian-health', 'guardian', 0, 100, 100),
  ...['horned-one', 'forest-spirit', 'church'].map((f) =>
    stat(`rep-${f}`, 'guardian', -100, 100, 0),
  ),
);
reg['flags']?.push(
  { id: 'innocent-lynched', description: 'Test flag.' } as never,
  { id: 'seed-sown', description: 'Test flag.' } as never,
);
reg['rules']?.push({ id: 'sanity-shock', description: 'Test rule.', params: ['cause'] } as never);
reg['contexts']?.push(
  { id: 'hysteria-calming', description: 'Test context.' } as never,
  { id: 'vs-creature', description: 'Test context.' } as never,
);

const collections = raw.collections;
collections.items?.push({
  file: 'relics.json',
  data: [
    {
      id: 'holy-water',
      tier: 'demo',
      category: 'consumable',
      icon: 'item.holy-water',
      stackSize: 10,
      tags: ['holy'],
      nameKey: t('item.holy-water.name'),
      descKey: t('item.holy-water.desc'),
    },
  ],
});

const ev = (
  id: string,
  category: string,
  tensionCost: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  tier: 'demo',
  nameKey: t(`event.${id}.name`),
  textKey: t(`event.${id}.text`),
  category,
  weight: 10,
  cooldownMinutes: 60,
  tensionCost,
  ...extra,
});
collections.events?.push({
  file: 'fear-events.json',
  data: [
    ev('creak', 'noise', 5),
    ev('steps', 'noise', 10, { cooldownMinutes: 90 }),
    ev('howl', 'noise', 15, { cooldownMinutes: 180, bias: { seasons: { winter: 2 } } }),
    ev('omen-seed', 'seed', 20, {
      cooldownMinutes: 1440,
      target: 'village',
      zone: 'village',
      effects: [{ setFlag: 'seed-sown' }, { addStat: 'hysteria', value: 4 }],
    }),
    ev('cradle', 'seed', 10, { cooldownMinutes: 720, target: 'village' }),
    ev('face', 'hallucination', 20, {
      cooldownMinutes: 720,
      bias: { lowSanity: 2 },
      effects: [{ addStat: 'sanity', value: -4 }],
    }),
    ev('whisper', 'hallucination', 10, {
      cooldownMinutes: 240,
      effects: [{ addStat: 'sanity', value: -2 }],
    }),
    ev('bell', 'seed', 30, {
      cooldownMinutes: 100000,
      window: { from: '03:33', to: '03:33' },
      target: 'village',
    }),
  ],
});

collections.pacts?.push({
  file: 'dark-pacts.json',
  data: [
    {
      id: 'dark-deal',
      tier: 'demo',
      nameKey: t('pact.dark-deal.name'),
      offerKey: t('pact.dark-deal.offer'),
      creditor: 'horned-one',
      zone: 'village',
      window: { from: '00:00', to: '23:59' },
      offerEffects: [{ addStat: 'rep-horned-one', value: 20 }],
      visibleTerms: [t('pact.dark-deal.term')],
      hiddenClauses: [
        {
          id: 'late',
          descKey: t('pact.dark-deal.clause.late'),
          trigger: { delayNights: { min: 3, max: 3 } },
          effects: [{ setFlag: 'b' }, { addStat: 'hysteria', value: 5 }],
        },
      ],
      debt: 'pact-minor',
      sin: 'wrath',
      blood: { stat: 'sanity-max', amount: 5 },
    },
  ],
});

collections.creatures = [
  {
    file: 'creatures.json',
    data: [
      {
        id: 'imp',
        tier: 'demo',
        nameKey: t('creature.imp.name'),
        descKey: t('creature.imp.desc'),
        origin: 'folklore',
        threat: 1,
        health: 20,
        resistanceTier: 0,
        weaknesses: [{ kind: 'item', item: 'holy-water', descKey: t('creature.imp.w') }],
        zones: ['forest'],
        ai: { speed: 2, sight: 3, hearing: 1, fleeLight: true, memory: 3, damage: 60 },
      },
      {
        id: 'walker',
        tier: 'demo',
        nameKey: t('creature.walker.name'),
        descKey: t('creature.walker.desc'),
        origin: 'folklore',
        threat: 2,
        health: 40,
        resistanceTier: 1,
        weaknesses: [{ kind: 'item', item: 'garlic', descKey: t('creature.walker.w') }],
        zones: ['village'],
        ai: { fleeLight: false },
      },
    ],
  },
];

collections['fear-rules'] = [
  {
    file: 'fear-rules.json',
    data: {
      id: 'default',
      tier: 'demo',
      sanity: {
        tiers: [
          { below: 0.7, effects: ['filter'] },
          { below: 0.5, effects: ['filter', 'whispers'], whisperKeys: [t('whisper.a')] },
          { below: 0.35, effects: ['filter', 'whispers', 'moving-objects'] },
          { below: 0.2, effects: ['filter', 'whispers', 'moving-objects', 'staring'] },
        ],
        shocks: { demonLearned: 8, forbiddenPerNotice: 0.5, causes: { sacrifice: 15 } },
        restore: {
          homeZones: ['village'],
          dawnAtHome: 20,
          faithDivisor: 20,
          lightPerHour: 1,
          restPerHour: 4,
        },
      },
      hysteria: {
        stages: { rumours: 40, accusations: 60, mob: 80 },
        decayPerDawn: 3,
        lowVillageSanity: { below: 40, factor: 1.5 },
        incidents: { death: 8, absentAtDawn: 3 },
        suspicionStat: 'suspicion',
        guardianStat: 'guardian-suspicion',
        guardianSuspicion: { absentAtDawn: 5, broken: 10, failedConfrontation: 10 },
        rumourStrength: 10,
        traitMultipliers: { weaver: 1.5 },
        guardianRumourWeight: 1.2,
        accusationSuspicion: 15,
        guardianAccusableAt: 70,
        mob: {
          skill: 'persuasion',
          context: 'hysteria-calming',
          difficulty: 'average',
          joinFear: 50,
          lynchAt: 85,
          beatAt: 70,
          calmRelief: 15,
          sparedRelief: 10,
          targetDiedRelief: 10,
          beaten: { fear: 30, health: 40 },
          guardianBeatenEffects: [
            { addStat: 'sanity', value: -20 },
            { addStat: 'guardian-suspicion', value: -30 },
          ],
          exploitEffects: [
            { addStat: 'corruption', value: 5 },
            { addStat: 'guardian-suspicion', value: -20 },
          ],
        },
        lynching: {
          cause: 'lynching',
          aftermathRelief: 20,
          innocentEffects: [
            { addStat: 'village-corruption', value: 15 },
            { addStat: 'creature-strength-rate', value: 0.1 },
            { setFlag: 'innocent-lynched' },
          ],
          complicitEffects: [{ addStat: 'corruption', value: 10 }],
        },
      },
      director: {
        mix: { noise: 45, seed: 35 },
        hallucination: { base: 0.2, pivot: 50, max: 0.6, perCorruption: 0.3 },
        fire: { base: 0.15, tensionDivisor: 100, recentPenalty: 0.1, min: 0.05, max: 0.7 },
        targets: { settle: 15, buildFrom: 25, buildTo: 60, peak: 85, release: 10 },
        settleShare: 0.2,
        peakAround: '03:33',
        peakHalfWidth: 60,
        decayPerTick: { settle: 4, build: 2, peak: 2, release: 12 },
        budget: {
          perNight: 140,
          shares: { settle: 0.1, build: 0.4, peak: 0.4, release: 0.1 },
        },
        peakCost: 20,
        quiet: { min: 30, max: 60 },
        zoneFactor: 2,
        offZoneFactor: 0.5,
        logSize: 300,
      },
      possession: {
        advance: { base: 0.35, perRank: 0.05, min: 0.05, max: 0.95 },
        vulnerability: { fear: 2, lowFaith: 1, faithStat: 'villager-faith' },
        falseSymptomChance: 0.2,
      },
      exorcism: {
        skill: 'occultism',
        context: 'vs-demon',
        difficulty: 'average',
        preparation: { maxItems: 4, holyTag: 'holy', circleItem: 'red-thread' },
        sanityPerTaunt: 3,
        maxTaunts: 4,
        expulsion: {
          rounds: 6,
          goal: 100,
          press: { progress: 30, sanity: 8 },
          hold: { progress: 15, sanity: 3 },
          pushPerRank: 5,
          breakBelow: 0.15,
        },
        success: { hostFear: 30 },
        failure: { guardianJumpChance: 0.25, sanity: 10 },
        bindDebt: 'pact-minor',
      },
      factions: [
        {
          id: 'horned-one',
          nameKey: t('faction.horned-one'),
          stat: 'rep-horned-one',
          hostileTo: ['forest-spirit', 'church'],
          hostility: 0.5,
        },
        {
          id: 'forest-spirit',
          nameKey: t('faction.forest-spirit'),
          stat: 'rep-forest-spirit',
          hostileTo: ['horned-one'],
          hostility: 0.5,
        },
        {
          id: 'church',
          nameKey: t('faction.church'),
          stat: 'rep-church',
          hostileTo: ['horned-one'],
          hostility: 1,
        },
      ],
      pacts: { sinReinforce: 5 },
      sacrifices: [
        {
          id: 'immured-shadow',
          nameKey: t('sacrifice.immured'),
          zone: 'village',
          items: [{ item: 'red-thread', qty: 1 }],
          escalation: 1,
          targeted: true,
          doomDays: { min: 3, max: 5 },
          effects: [
            { addStat: 'village-corruption', value: 25 },
            { rule: 'sanity-shock', params: { cause: 'sacrifice' } },
          ],
          witnessChance: 0.5,
          witnessedHysteria: 10,
          witnessedSuspicion: 20,
        },
      ],
      night: {
        homeZone: 'village',
        healthStat: 'guardian-health',
        spawns: [
          { zone: 'forest', poi: 'meadow' },
          { zone: 'village', poi: 'well' },
        ],
        originCandidates: [
          { zone: 'forest', poi: 'oil-cache' },
          { zone: 'forest', poi: 'well' },
        ],
        originEffects: [{ addStat: 'hysteria', value: -5 }],
        returnEffects: [{ addStat: 'hysteria', value: -3 }],
        spawnChance: { settle: 0.5, build: 0.5, peak: 0.5, release: 0.5 },
        maxActive: 2,
        flashFuel: 0.25,
        strikeDamage: 25,
        skills: {
          strike: 'craft',
          dodge: 'herbalism',
          flee: 'herbalism',
          sneak: 'investigation',
          ritual: 'faith',
          lastBreath: 'faith',
        },
        lastBreathHealth: 30,
      },
      evidence: {
        windowMinutes: 120,
        photograph: { real: 0.85, hallucination: 0.1 },
        witness: { real: 0.75, hallucination: 0.15, minAffinity: 0 },
        relic: { real: 0.8, hallucination: 0.2, tag: 'holy' },
      },
    },
  },
];

const result = validatePack(raw);
if (!result.ok) {
  throw new Error(
    `fear fixture is invalid:\n${result.issues.map((i) => `${i.code} ${i.entity ?? ''} ${i.path ?? ''}: ${i.message}`).join('\n')}`,
  );
}

export const fearDb = new ContentDatabase(result.pack, { version: '0.1.0', hash: 'fear-test' });
export const fearRaw = raw;
