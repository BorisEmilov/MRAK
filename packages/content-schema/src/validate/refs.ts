import { COLLECTION_NAMES, COLLECTIONS, type ContentPack, type SourceMap } from '../pack';
import type { ContentTier, RefKind } from '../primitives';
import { collectRefs, forEachObject } from '../walk';
import type { IssueList } from './issues';

/** Id → tier for every referenceable kind. Registry and locale entries have no tier. */
export type RefIndex = Map<RefKind, Map<string, ContentTier | null>>;

export function buildRefIndex(pack: ContentPack): RefIndex {
  const index: RefIndex = new Map();
  const add = (kind: RefKind, id: string, tier: ContentTier | null): void => {
    let ids = index.get(kind);
    if (!ids) {
      ids = new Map();
      index.set(kind, ids);
    }
    ids.set(id, tier);
  };
  for (const name of COLLECTION_NAMES) {
    for (const entity of pack[name]) add(COLLECTIONS[name].kind, entity.id, entity.tier);
  }
  for (const mystery of pack.mysteries)
    for (const clue of mystery.clues) add('clue', clue.id, mystery.tier);
  for (const f of pack.registry.flags) add('flag', f.id, null);
  for (const s of pack.registry.stats) add('stat', s.id, null);
  for (const r of pack.registry.rules) add('rule', r.id, null);
  for (const c of pack.registry.contexts) add('context', c.id, null);
  for (const key of Object.keys(pack.locales.en)) add('loc', key, null);
  return index;
}

const REGISTRY_HINT: Partial<Record<RefKind, string>> = {
  flag: 'declare it in data/flags.json "flags"',
  stat: 'declare it in data/flags.json "stats"',
  rule: 'declare it in data/flags.json "rules"',
  context: 'declare it in data/flags.json "contexts"',
  loc: 'add the key to locales/en.json',
};

/**
 * Checks that every reference exists, that demo content never points at full content, that
 * villager-scoped stats name a villager, that rule params are declared, and nested ids
 * (zone variants, quest stages, clue sources) exist.
 */
export function validateRefs(
  pack: ContentPack,
  sources: SourceMap,
  index: RefIndex,
  issues: IssueList,
): void {
  const stats = new Map(pack.registry.stats.map((s) => [s.id, s]));
  const rules = new Map(pack.registry.rules.map((r) => [r.id, r]));
  const zones = new Map(pack.zones.map((z) => [z.id, z]));
  const quests = new Map(pack.quests.map((q) => [q.id, q]));

  for (const name of COLLECTION_NAMES) {
    const { schema } = COLLECTIONS[name];
    for (const entity of pack[name]) {
      const where = { file: sources[name]?.[entity.id], entity: `${name}/${entity.id}` };

      for (const found of collectRefs(schema, entity)) {
        const targets = index.get(found.kind);
        const exists = targets?.has(found.id) ?? false;
        if (!exists) {
          const hint = REGISTRY_HINT[found.kind];
          issues.error(
            found.kind === 'loc' ? 'missing-loc-key' : `unknown-${found.kind}`,
            `unknown ${found.kind} "${found.id}"${hint ? ` — ${hint}` : ''}`,
            { ...where, path: found.path },
          );
          continue;
        }
        // Tree nodes carry their own tier (checked in validateTree).
        const isTreeNodeTalent = name === 'trees' && /^nodes\[\d+\]\.talent$/.test(found.path);
        if (!isTreeNodeTalent && entity.tier === 'demo' && targets?.get(found.id) === 'full') {
          issues.error(
            'demo-depends-on-full',
            `demo content references full-game ${found.kind} "${found.id}"`,
            { ...where, path: found.path },
          );
        }
      }

      forEachObject(entity, (node, path) => {
        // Villager-scoped stats must say which villager.
        for (const key of ['stat', 'addStat', 'setStat'] as const) {
          const statId = node[key];
          if (typeof statId !== 'string') continue;
          const decl = stats.get(statId);
          if (decl?.scope === 'villager' && typeof node['villager'] !== 'string') {
            issues.error(
              'stat-needs-villager',
              `stat "${statId}" is per-villager: add "villager"`,
              {
                ...where,
                path,
              },
            );
          }
          if (decl && decl.scope !== 'villager' && typeof node['villager'] === 'string') {
            issues.error(
              'stat-not-villager',
              `stat "${statId}" has scope "${decl.scope}", not villager`,
              {
                ...where,
                path,
              },
            );
          }
        }
        // Rule params must be declared.
        if (
          typeof node['rule'] === 'string' &&
          typeof node['params'] === 'object' &&
          node['params']
        ) {
          const declared = new Set(rules.get(node['rule'])?.params ?? []);
          for (const param of Object.keys(node['params'])) {
            if (!declared.has(param)) {
              issues.error('unknown-rule-param', `rule "${node['rule']}" has no param "${param}"`, {
                ...where,
                path,
              });
            }
          }
        }
        // Zone variants.
        if (typeof node['setZoneVariant'] === 'string' && typeof node['variant'] === 'string') {
          const zone = zones.get(node['setZoneVariant']);
          if (zone && !zone.variants.some((v) => v.id === node['variant'])) {
            issues.error(
              'unknown-zone-variant',
              `zone "${zone.id}" has no variant "${node['variant']}"`,
              {
                ...where,
                path,
              },
            );
          }
        }
        // Quest stages.
        if (typeof node['quest'] === 'string' && typeof node['stage'] === 'string') {
          const quest = quests.get(node['quest']);
          if (quest && !quest.stages.some((s) => s.id === node['stage'])) {
            issues.error(
              'unknown-quest-stage',
              `quest "${quest.id}" has no stage "${node['stage']}"`,
              {
                ...where,
                path,
              },
            );
          }
        }
      });
    }
  }

  // Clue sources point at different collections depending on their kind.
  for (const mystery of pack.mysteries) {
    const where = { file: sources.mysteries?.[mystery.id], entity: `mysteries/${mystery.id}` };
    mystery.clues.forEach((clue, ci) => {
      clue.sources.forEach((source, si) => {
        const targets = index.get(source.kind);
        const path = `clues[${ci}].sources[${si}].ref`;
        if (!targets?.has(source.ref)) {
          issues.error(`unknown-${source.kind}`, `unknown ${source.kind} "${source.ref}"`, {
            ...where,
            path,
          });
        } else if (mystery.tier === 'demo' && targets.get(source.ref) === 'full') {
          issues.error(
            'demo-depends-on-full',
            `demo clue source is full-game ${source.kind} "${source.ref}"`,
            {
              ...where,
              path,
            },
          );
        }
      });
    });
  }
}
