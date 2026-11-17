/** Village notices for the HUD (docs/ui/hud.md): which core events deserve a line, and for how long. */
import type { LocaleKey } from '@mrak/content';
import type { ContentDatabase, CoreEvent } from '@mrak/core';
import type { IconName } from '@mrak/ui-kit';

export const NOTICE_TTL_MS = 12_000;
export const MAX_NOTICES = 3;
/** A hysteria jump at least this large is announced. */
export const HYSTERIA_NOTICE_STEP = 5;

export interface Notice {
  id: number;
  icon: IconName;
  key: LocaleKey;
  params: Record<string, string | number>;
  tone: 'neutral' | 'bad' | 'good';
  expiresAt: number;
}

let nextId = 1;

export function makeNotice(
  icon: IconName,
  key: LocaleKey,
  params: Notice['params'],
  tone: Notice['tone'],
  now: number,
): Notice {
  return { id: nextId++, icon, key, params, tone, expiresAt: now + NOTICE_TTL_MS };
}

function nameOf(
  content: ContentDatabase,
  collection: 'quests' | 'mysteries' | 'events',
  id: string,
): string {
  const entity = content.find(collection, id);
  return entity && 'nameKey' in entity ? entity.nameKey : id;
}

/** Notices for a batch of events. `name` resolves a localization key to text. */
export function noticesFrom(
  events: readonly CoreEvent[],
  content: ContentDatabase,
  name: (key: string) => string,
  now: number,
): Notice[] {
  const out: Notice[] = [];
  const make = (
    icon: IconName,
    key: LocaleKey,
    params: Notice['params'],
    tone: Notice['tone'],
  ): void => {
    out.push(makeNotice(icon, key, params, tone, now));
  };
  const villager = (id: string): string => name(content.find('villagers', id)?.nameKey ?? id);
  const itemName = (id: string): string => name(content.find('items', id)?.nameKey ?? id);
  // Work brought home at dusk is announced once, not item by item.
  const delivered = new Set(
    events.flatMap((e) => (e.type === 'task/delivered' ? Object.keys(e.payload.items) : [])),
  );
  // Gathered herbs and brews have their own line; a tale told has its own line.
  const gathered = new Set(
    events.flatMap((e) => (e.type === 'gather/gathered' ? [e.payload.item] : [])),
  );
  const brewing = events.some((e) => e.type === 'alchemy/brewed' || e.type === 'alchemy/failed');
  const told = new Set(
    events.flatMap((e) => (e.type === 'villager/talked' && e.payload.tale ? [e.payload.tale] : [])),
  );
  const itemIcon = (id: string): IconName =>
    (content.find('items', id)?.icon as IconName | undefined) ?? 'ui.inventory';
  for (const e of events) {
    switch (e.type) {
      case 'state/statChanged':
        if (
          e.payload.stat === 'hysteria' &&
          Math.abs(e.payload.to - e.payload.from) >= HYSTERIA_NOTICE_STEP
        )
          make(
            'resource.hysteria',
            e.payload.to > e.payload.from ? 'notice.hysteria-up' : 'notice.hysteria-down',
            {},
            e.payload.to > e.payload.from ? 'bad' : 'good',
          );
        break;
      case 'quest/started':
        make(
          'ui.journal',
          'notice.quest-started',
          { quest: name(nameOf(content, 'quests', e.payload.quest)) },
          'neutral',
        );
        break;
      case 'quest/failed':
        make(
          'ui.journal',
          'notice.quest-failed',
          { quest: name(nameOf(content, 'quests', e.payload.quest)) },
          'bad',
        );
        break;
      case 'quest/stageAdvanced':
        make(
          'ui.quest',
          'notice.quest-advanced',
          { quest: name(nameOf(content, 'quests', e.payload.quest)) },
          'neutral',
        );
        break;
      case 'quest/completed':
        make(
          'ui.quest',
          'notice.quest-completed',
          { quest: name(nameOf(content, 'quests', e.payload.quest)) },
          'good',
        );
        break;
      case 'achievement/unlocked':
        make(
          'ui.achievements',
          'notice.achievement',
          { name: name(content.find('achievements', e.payload.id)?.nameKey ?? e.payload.id) },
          'good',
        );
        break;
      case 'quest/blocked':
        make(
          'ui.quest',
          'notice.quest-blocked',
          {
            quest: name(nameOf(content, 'quests', e.payload.quest)),
            by: name(nameOf(content, 'quests', e.payload.by)),
          },
          'neutral',
        );
        break;
      // A point of no return: only a candle going out, never a warning (quests.md).
      case 'quest/noReturn':
        make('ui.candle', 'notice.candle', {}, 'neutral');
        break;
      case 'mystery/started':
        make(
          'event.seed',
          'notice.mystery-started',
          { mystery: name(nameOf(content, 'mysteries', e.payload.mystery)) },
          'neutral',
        );
        break;
      case 'possession/began':
        make('villager-state.possessed', 'notice.possession', {}, 'bad');
        break;
      case 'debt/added':
        make('debt.debt', 'notice.debt', { amount: e.payload.amount }, 'bad');
        break;
      case 'world/zoneEntered': {
        const zone = content.find('zones', e.payload.zone);
        make(
          'ui.map',
          'notice.zone-entered',
          { zone: name(zone?.nameKey ?? e.payload.zone) },
          'neutral',
        );
        break;
      }
      case 'state/narrated':
        make('ui.info', e.payload.key as LocaleKey, {}, 'neutral');
        break;
      case 'task/delivered':
        make(
          'faction.village',
          'notice.delivered',
          {
            items: Object.entries(e.payload.items)
              .map(([item, qty]) => `${String(qty)} ${itemName(item)}`)
              .join(', '),
          },
          'good',
        );
        break;
      case 'villager/died':
        make(
          'villager-state.dead',
          'notice.villager-died',
          { name: villager(e.payload.villager) },
          'bad',
        );
        break;
      case 'villager/buried':
        make(
          'villager-state.dead',
          e.payload.proper ? 'notice.buried' : 'notice.buried-badly',
          { name: villager(e.payload.villager) },
          e.payload.proper ? 'neutral' : 'bad',
        );
        break;
      case 'villager/returned':
        make(
          'villager-state.returned',
          'notice.villager-returned',
          { name: villager(e.payload.villager) },
          'bad',
        );
        break;
      case 'villager/laidToRest':
        make(
          'villager-state.dead',
          'notice.laid-to-rest',
          { name: villager(e.payload.villager) },
          'good',
        );
        break;
      case 'villager/panicked':
        make(
          'villager-state.afraid',
          'notice.panicked',
          { name: villager(e.payload.villager) },
          'bad',
        );
        break;
      case 'villager/statusChanged':
        if (e.payload.to === 'sick' || e.payload.to === 'terrified')
          make(
            e.payload.to === 'sick' ? 'villager-state.sick' : 'villager-state.afraid',
            e.payload.to === 'sick' ? 'notice.villager-sick' : 'notice.villager-terrified',
            { name: villager(e.payload.villager) },
            'bad',
          );
        break;
      case 'villager/secretRevealed':
        make('ui.journal', 'notice.secret', { name: villager(e.payload.villager) }, 'neutral');
        break;
      case 'village/coldNight':
        make('need.cold', 'notice.cold-night', { count: e.payload.homes.length }, 'bad');
        break;
      case 'village/mealShort':
        make('need.hunger', 'notice.meal-short', { count: e.payload.villagers.length }, 'bad');
        break;
      case 'task/stalled':
        make(
          'ui.warning',
          'notice.task-stalled',
          { name: villager(e.payload.villager), item: itemName(e.payload.item) },
          'bad',
        );
        break;
      case 'task/interrupted':
        if (e.payload.cause !== 'died')
          make(
            'task.watch',
            e.payload.cause === 'fear'
              ? 'notice.task-fled'
              : e.payload.cause === 'sick'
                ? 'notice.task-sick'
                : 'notice.task-no-materials',
            { name: villager(e.payload.villager) },
            'bad',
          );
        break;
      case 'gather/gathered':
        make(
          itemIcon(e.payload.item),
          e.payload.potency > 1 ? 'notice.gathered-strong' : 'notice.gathered',
          {
            qty: e.payload.qty,
            item: itemName(e.payload.item),
            strength: name(e.payload.potency >= 3 ? 'items.potency.3' : 'items.potency.2'),
          },
          'good',
        );
        break;
      case 'inventory/full':
        make(
          'ui.inventory',
          'notice.pack-full',
          { item: itemName(e.payload.item), where: name(`items.where.${e.payload.where}`) },
          'bad',
        );
        break;
      case 'collection/found':
        if (content.find('items', e.payload.item)?.cursed)
          make(
            'collection.cursed',
            'notice.cursed-found',
            { item: itemName(e.payload.item) },
            'bad',
          );
        break;
      case 'villager/talked': {
        const who = villager(e.payload.villager);
        const tale = e.payload.tale ? content.find('collectibles', e.payload.tale) : undefined;
        if (tale)
          make(
            tale.kind === 'song' ? 'collection.songs' : 'collection.tales',
            'notice.talk-tale',
            { name: who, tale: name(tale.nameKey) },
            'good',
          );
        else make('action.talk', `notice.talk-small.${e.payload.mood}`, { name: who }, 'neutral');
        break;
      }
      case 'journal/collectibleGranted': {
        if (told.has(e.payload.collectible)) break;
        const c = content.find('collectibles', e.payload.collectible);
        make(
          'ui.collection',
          'notice.collectible',
          { name: name(c?.nameKey ?? e.payload.collectible) },
          'good',
        );
        break;
      }
      case 'photo/taken':
        if (e.payload.layers.length === 0)
          make('action.photograph', 'notice.photo-taken', {}, 'neutral');
        break;
      case 'photo/layerRevealed': {
        const layer = content.find('photo-layers', e.payload.layer);
        make(
          layer?.kind === 'possessed'
            ? 'layer.possessed'
            : layer?.kind === 'symbol'
              ? 'layer.symbol'
              : 'layer.presence',
          'notice.photo-layer',
          { layer: name(layer?.nameKey ?? e.payload.layer) },
          'bad',
        );
        break;
      }
      case 'collection/completed':
        make(
          `collection.${e.payload.category}` as IconName,
          'notice.collection-complete',
          { category: name(`items.collection.cat.${e.payload.category}`) },
          'good',
        );
        break;
      case 'inventory/itemAdded': {
        if (delivered.has(e.payload.item) || gathered.has(e.payload.item) || brewing) break;
        if (e.payload.to === 'ground') break;
        const item = content.find('items', e.payload.item);
        make(
          itemIcon(e.payload.item),
          'notice.item-gained',
          { qty: e.payload.qty, item: name(item?.nameKey ?? e.payload.item) },
          'good',
        );
        break;
      }
      // fear engine (docs/systems/hysteria.md, event-director.md, sanity.md)
      case 'hysteria/rumourSpread':
        if (e.payload.target === 'guardian')
          make('resource.hysteria', 'notice.hysteria.rumour-guardian', {}, 'bad');
        else
          make(
            'resource.hysteria',
            'notice.hysteria.rumour',
            { name: villager(e.payload.target) },
            'neutral',
          );
        break;
      case 'hysteria/accusationMade':
        if (e.payload.target === 'guardian')
          make('resource.hysteria', 'notice.hysteria.accusation-guardian', {}, 'bad');
        else
          make(
            'resource.hysteria',
            'notice.hysteria.accusation',
            { name: villager(e.payload.target) },
            'bad',
          );
        break;
      case 'hysteria/mobFormed':
        if (e.payload.target === 'guardian')
          make('ui.warning', 'notice.hysteria.mob-guardian', {}, 'bad');
        else make('ui.warning', 'notice.hysteria.mob', { name: villager(e.payload.target) }, 'bad');
        break;
      case 'hysteria/mobSteered':
        make(
          'resource.hysteria',
          'notice.hysteria.mob-steered',
          { from: villager(e.payload.from), to: villager(e.payload.to) },
          'bad',
        );
        break;
      case 'hysteria/mobDispersed':
        if (e.payload.target === 'guardian')
          make('resource.hysteria', 'notice.hysteria.mob-dispersed-guardian', {}, 'good');
        else
          make(
            'resource.hysteria',
            'notice.hysteria.mob-dispersed',
            { name: villager(e.payload.target) },
            'good',
          );
        break;
      case 'hysteria/trialHeld':
        if (e.payload.target === 'guardian') {
          if (e.payload.verdict !== 'spared')
            make('ui.warning', 'notice.hysteria.trial-guardian', {}, 'bad');
        } else if (e.payload.verdict === 'lynched')
          make(
            'ui.warning',
            'notice.hysteria.lynching',
            { name: villager(e.payload.target) },
            'bad',
          );
        else
          make(
            'resource.hysteria',
            e.payload.verdict === 'beaten'
              ? 'notice.hysteria.trial-beaten'
              : 'notice.hysteria.trial-spared',
            { name: villager(e.payload.target) },
            e.payload.verdict === 'beaten' ? 'bad' : 'neutral',
          );
        break;
      case 'director/evidenceFound':
        make(
          e.payload.method === 'photograph' ? 'action.photograph' : 'resource.sanity',
          `notice.evidence.${e.payload.method}.${e.payload.presence ? 'presence' : 'absence'}`,
          {},
          'neutral',
        );
        break;
      case 'pact/clauseTriggered': {
        const pact = content.find('pacts', e.payload.pact);
        make(
          'ui.pact',
          'notice.pact.clause',
          { pact: name(pact?.nameKey ?? e.payload.pact) },
          'bad',
        );
        break;
      }
      case 'mystery/clueRetracted': {
        const clue = content
          .find('mysteries', e.payload.mystery)
          ?.clues.find((c) => c.id === e.payload.clue);
        make(
          'ui.clues',
          'notice.mystery.retracted',
          { clue: name(clue?.nameKey ?? e.payload.clue) },
          'neutral',
        );
        break;
      }
      case 'mystery/concluded':
        // Never says whether the answer was right: the world will.
        make('ui.clues', 'notice.mystery.concluded', {}, 'neutral');
        break;
      case 'night/originFound':
        make('action.investigate', 'notice.night.origin-found', {}, 'good');
        break;
      case 'night/originEmpty':
        make('action.investigate', 'notice.night.origin-empty', {}, 'neutral');
        break;
      case 'night/completed':
        make('phase.dawn', 'notice.night.completed', {}, 'good');
        break;
      case 'night/encounterEnded':
        make(
          'ui.demons',
          'notice.night.banished',
          {
            creature: name(
              content.find('creatures', e.payload.creature)?.nameKey ?? e.payload.creature,
            ),
          },
          'good',
        );
        break;
      case 'night/hurt':
        make('ui.warning', 'notice.night.hurt', {}, 'bad');
        break;
      case 'guardian/lastBreath':
        make('resource.sanity', 'notice.night.last-breath', {}, 'bad');
        break;
      case 'lineage/heirNeeded':
        make('ui.warning', 'notice.lineage.heir', {}, 'bad');
        break;
      case 'village/alert':
        make('faction.village', 'notice.village.alert', {}, 'bad');
        break;
      // village growth, festivals and the lineage (village-growth.md, lineage.md)
      case 'village/buildingBuilt':
        make(
          (content.find('buildings', e.payload.building)?.icon ?? 'faction.village') as IconName,
          'notice.village.built',
          {
            building: name(
              content.find('buildings', e.payload.building)?.nameKey ?? e.payload.building,
            ),
            level: e.payload.level,
          },
          'good',
        );
        break;
      case 'village/prosperityChanged':
        make(
          'faction.village',
          'notice.village.prosperity',
          { level: e.payload.to },
          e.payload.to > e.payload.from ? 'good' : 'bad',
        );
        break;
      case 'village/residentArrived':
        if (e.payload.origin === 'outsider')
          make('faction.village', 'notice.village.newcomer', {}, 'neutral');
        break;
      case 'festival/ritePerformed':
        make('ui.candle', 'notice.festival.rite', {}, e.payload.success ? 'good' : 'bad');
        break;
      case 'lineage/familyChanged':
        make(
          'ui.heir',
          `notice.lineage.${e.payload.role === 'child' ? 'birth' : 'family'}`,
          {},
          'good',
        );
        break;
      case 'lineage/generationEnded':
        make('ui.heir', 'notice.lineage.ended', { legacy: e.payload.legacy }, 'neutral');
        break;
      case 'endless/unlocked':
        make('ui.history', 'notice.endless.unlocked', {}, 'good');
        break;
      case 'endless/mysteryGenerated':
        make('ui.clues', 'notice.endless.mystery', {}, 'neutral');
        break;
      case 'endless/goalReached':
        make('ui.achievements', 'notice.endless.goal', { legacy: e.payload.legacy }, 'good');
        break;
      case 'endless/relicUnlocked':
        make('ui.talents', 'notice.endless.relic', {}, 'good');
        break;
      case 'seasonal/activated':
        make('ui.candle', 'notice.seasonal.activated', { legacy: e.payload.legacy }, 'good');
        break;
      case 'lineage/heirChosen':
        make('ui.heir', 'notice.lineage.heir-chosen', { generation: e.payload.generation }, 'good');
        break;
      case 'sacrifice/witnessed':
        make('resource.hysteria', 'notice.sacrifice.witnessed', {}, 'bad');
        break;
      case 'sanity/broken':
        make('resource.sanity', 'notice.sanity.broken', {}, 'bad');
        break;
      case 'light/lanternOut':
        make('resource.light', 'notice.lantern-out', {}, 'bad');
        break;
      case 'light/darknessChanged':
        if (e.payload.dark) make('resource.sanity', 'notice.darkness', {}, 'bad');
        break;
      // guardian progression (docs/systems/progression.md, UI task 16)
      case 'revelation/awarded':
        make(
          'resource.revelation',
          'notice.revelation',
          { amount: e.payload.amount, reason: name(e.payload.reasonKey) },
          'good',
        );
        break;
      case 'skill/rankUp':
        make(
          `skill.${e.payload.skill}` as IconName,
          'notice.rank-up',
          { skill: name(`skill.${e.payload.skill}.name`), rank: e.payload.rank },
          'good',
        );
        break;
      case 'skill/readyToGrow':
        make(
          `skill.${e.payload.skill}` as IconName,
          'notice.ready-to-grow',
          { skill: name(`skill.${e.payload.skill}.name`) },
          'neutral',
        );
        break;
      case 'debt/collected':
        make('debt.debt', 'notice.debt-collected', { text: name(e.payload.descKey) }, 'bad');
        break;
      case 'debt/paid':
        make('debt.debt', 'notice.debt-paid', { amount: e.payload.amount }, 'good');
        break;
      case 'sin/tookOver':
        make(
          'ui.sin',
          'notice.sin-took-over',
          { sin: name(content.find('sins', e.payload.sin)?.nameKey ?? e.payload.sin) },
          'bad',
        );
        break;
      case 'virtue/acted':
        make(
          'ui.virtue',
          'notice.virtue',
          { virtue: name(content.find('virtues', e.payload.virtue)?.nameKey ?? e.payload.virtue) },
          'good',
        );
        break;
      case 'gear/blessingExpired':
        make(
          'ui.blessing',
          'notice.blessing-expired',
          {
            blessing: name(
              content.find('blessings', e.payload.blessing)?.nameKey ?? e.payload.blessing,
            ),
            gear: name(content.find('gear', e.payload.gear)?.nameKey ?? e.payload.gear),
          },
          'neutral',
        );
        break;
      default:
        break;
    }
  }
  return out;
}

/** Revelation notices wait for dawn: no reward is announced in the middle of a scare (R5). */
export function holdUntilDawn(
  added: readonly Notice[],
  night: boolean,
): { show: Notice[]; hold: Notice[] } {
  if (!night) return { show: [...added], hold: [] };
  return {
    show: added.filter((n) => n.key !== 'notice.revelation'),
    hold: added.filter((n) => n.key === 'notice.revelation'),
  };
}

/** Held Revelation notices, summed into one line at dawn. */
export function dawnRevelation(held: readonly Notice[], now: number): Notice[] {
  if (held.length === 0) return [];
  const total = held.reduce((sum, n) => sum + Number(n.params['amount'] ?? 0), 0);
  return [
    makeNotice('resource.revelation', 'notice.revelation-dawn', { amount: total }, 'good', now),
  ];
}

/** Adds new notices, drops expired ones, keeps the newest MAX_NOTICES. */
export function mergeNotices(
  current: readonly Notice[],
  added: readonly Notice[],
  now: number,
): Notice[] {
  return [...current, ...added].filter((n) => n.expiresAt > now).slice(-MAX_NOTICES);
}
