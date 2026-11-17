/** Entity-specific semantic rules beyond references and trees. */
import type { Zone } from '../entities/world';
import type { CollectionName, ContentPack, SourceMap } from '../pack';
import type { IssueList } from './issues';

type Where = { file: string | undefined; entity: string; path?: string };

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(ids.filter((id) => seen.has(id) || !seen.add(id)))];
}

/** POIs and the path graph of a zone (docs/systems/night-exploration.md). */
function validateZoneGraph(z: Zone, where: Where, issues: IssueList): void {
  for (const id of duplicates(z.pois.map((p) => p.id)))
    issues.error('duplicate-id', `duplicate POI id "${id}"`, where);
  const nodes = new Set(z.paths.nodes.map((n) => n.id));
  for (const id of duplicates(z.paths.nodes.map((n) => n.id)))
    issues.error('duplicate-id', `duplicate path node "${id}"`, where);
  for (const id of duplicates(z.paths.edges.map((e) => e.id)))
    issues.error('duplicate-id', `duplicate path edge "${id}"`, where);
  if (!z.paths.nodes.some((n) => n.exit))
    issues.error('zone-no-exit', 'the path graph needs at least one exit node', where);
  const groups = new Map<string, number>();
  for (const e of z.paths.edges) {
    for (const end of [e.from, e.to])
      if (!nodes.has(end))
        issues.error('zone-path-node', `edge "${e.id}" uses unknown node "${end}"`, where);
    if (e.from === e.to) issues.error('zone-path-loop', `edge "${e.id}" is a loop`, where);
    if (e.shift) groups.set(e.shift, (groups.get(e.shift) ?? 0) + 1);
  }
  for (const [group, count] of groups)
    if (count < 2)
      issues.error('zone-shift-group', `shift group "${group}" needs ≥ 2 alternatives`, where);
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validMonthDay(md: string): boolean {
  const [m, d] = md.split('-').map(Number);
  return m !== undefined && d !== undefined && d <= (DAYS_IN_MONTH[m - 1] ?? 0);
}

export function validateMysteries(pack: ContentPack, sources: SourceMap, issues: IssueList): void {
  for (const m of pack.mysteries) {
    const where = { file: sources.mysteries?.[m.id], entity: `mysteries/${m.id}` };
    const suspects = new Set(m.suspects.map((s) => s.villager));
    const causes = new Set(m.causes.map((c) => c.id));
    const remedies = new Set(m.remedies.map((r) => r.id));
    const clueIds = new Set<string>();

    for (const [i, clue] of m.clues.entries()) {
      if (clueIds.has(clue.id))
        issues.error('duplicate-id', `duplicate clue id "${clue.id}"`, where);
      clueIds.add(clue.id);
      for (const prop of [...clue.supports, ...clue.refutes]) {
        const [type, id = ''] = prop.split(':');
        const known =
          type === 'culprit' || type === 'motive' || type === 'opportunity'
            ? suspects.has(id)
            : type === 'cause'
              ? causes.has(id)
              : remedies.has(id);
        if (!known) {
          issues.error(
            'mystery-unknown-proposition',
            `proposition "${prop}" names nothing in this mystery`,
            {
              ...where,
              path: `clues[${String(i)}]`,
            },
          );
        }
      }
    }

    if (!suspects.has(m.solution.culprit)) {
      issues.error(
        'mystery-culprit-not-suspect',
        `culprit "${m.solution.culprit}" is not a suspect`,
        where,
      );
    }
    if (!causes.has(m.solution.cause))
      issues.error('mystery-unknown-cause', `unknown cause "${m.solution.cause}"`, where);
    if (!remedies.has(m.solution.remedy)) {
      issues.error('mystery-unknown-remedy', `unknown remedy "${m.solution.remedy}"`, where);
    }

    // Provable from solid clues alone (docs/lore/mysteries.md writing rules 2 and 3).
    const solidFor = (prop: string): number =>
      m.clues.filter((c) => c.reliability === 'solid' && c.supports.includes(prop)).length;
    if (solidFor(`culprit:${m.solution.culprit}`) < 2) {
      issues.error(
        'mystery-culprit-unprovable',
        'the true culprit needs at least 2 solid supporting clues',
        where,
      );
    }
    if (solidFor(`cause:${m.solution.cause}`) < 1) {
      issues.error(
        'mystery-cause-unprovable',
        'the true cause needs at least 1 solid supporting clue',
        where,
      );
    }
    // Every false suspect has a true innocent explanation (rule 1).
    for (const s of m.suspects) {
      if (s.villager === m.solution.culprit) continue;
      const exonerated = m.clues.some((c) => c.refutes.includes(`culprit:${s.villager}`));
      if (!exonerated) {
        issues.error(
          'mystery-suspect-not-exonerable',
          `false suspect "${s.villager}" has no exonerating clue`,
          where,
        );
      }
      if (!s.whyInnocentKey) {
        issues.error(
          'mystery-suspect-no-innocence',
          `false suspect "${s.villager}" needs "whyInnocentKey"`,
          where,
        );
      }
    }
    // An outcome for every suspect.
    const outcomeFor = new Set(m.outcomes.map((o) => o.culprit));
    for (const s of suspects) {
      if (!outcomeFor.has(s))
        issues.error('mystery-missing-outcome', `no outcome for accusing "${s}"`, where);
    }
  }
}

export function validateCallings(pack: ContentPack, sources: SourceMap, issues: IssueList): void {
  const trees = new Map(pack.trees.map((t) => [t.id, t]));
  for (const c of pack.callings) {
    const where = { file: sources.callings?.[c.id], entity: `callings/${c.id}` };
    if (new Set(c.attributeBonuses).size !== c.attributeBonuses.length) {
      issues.error(
        'calling-duplicate-attribute',
        'attribute bonuses must be two different attributes',
        where,
      );
    }
    if (new Set(c.callingSkills).size !== c.callingSkills.length) {
      issues.error('calling-duplicate-skill', 'calling skills must be distinct', where);
    }
    for (const s of c.startingRanks) {
      if (!c.callingSkills.includes(s)) {
        issues.error(
          'calling-rank-not-calling-skill',
          `starting rank "${s}" is not a calling skill`,
          where,
        );
      }
    }
    for (const t of c.trees) {
      const tree = trees.get(t);
      if (tree && (tree.kind !== 'calling' || tree.calling !== c.id)) {
        issues.error(
          'calling-tree-mismatch',
          `tree "${t}" does not belong to calling "${c.id}"`,
          where,
        );
      }
    }
  }
}

export function validateBloodline(pack: ContentPack, sources: SourceMap, issues: IssueList): void {
  const nodes = new Map(pack['bloodline-nodes'].map((n) => [n.id, n]));
  for (const n of nodes.values()) {
    const where = { file: sources['bloodline-nodes']?.[n.id], entity: `bloodline-nodes/${n.id}` };
    for (const r of n.requires) {
      const req = nodes.get(r);
      if (req && req.level > n.level) {
        issues.error('bloodline-prereq-higher', `requires "${r}" of a higher level`, where);
      }
    }
    for (const x of n.exclusiveWith) {
      if (!nodes.get(x)?.exclusiveWith.includes(n.id)) {
        issues.error(
          'bloodline-exclusive-asymmetric',
          `"${x}" must also list "${n.id}" in exclusiveWith`,
          where,
        );
      }
    }
  }
  // Cycles.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 'done') return false;
    if (state.get(id) === 'visiting') return true;
    state.set(id, 'visiting');
    const cyclic = (nodes.get(id)?.requires ?? []).some(visit);
    state.set(id, 'done');
    return cyclic;
  };
  for (const id of nodes.keys()) {
    state.clear();
    if (visit(id))
      issues.error('bloodline-cycle', `prerequisite cycle through "${id}"`, {
        entity: `bloodline-nodes/${id}`,
      });
  }
}

/**
 * Fear engine (docs/systems/event-director.md rule 5): hallucinations may only touch the
 * guardian's own stats; director events need the fear rules.
 */
function validateFear(pack: ContentPack, sources: SourceMap, issues: IssueList): void {
  const scope = new Map(pack.registry.stats.map((s) => [s.id, s.scope]));
  for (const e of pack.events) {
    if (e.category !== 'hallucination') continue;
    const where = { file: sources.events?.[e.id], entity: `events/${e.id}` };
    for (const fx of e.effects) {
      const stat = 'addStat' in fx ? fx.addStat : 'setStat' in fx ? fx.setStat : null;
      const ok =
        'narrate' in fx || (stat !== null && scope.get(stat) === 'guardian' && !('villager' in fx));
      if (!ok)
        issues.error(
          'hallucination-world-effect',
          'hallucinations may only change guardian stats or narrate',
          where,
        );
    }
  }
  for (const m of pack.mysteries)
    for (const c of m.clues) {
      if (!c.liar) continue;
      const v = pack.villagers.find((x) => x.id === c.liar?.villager);
      if (v && !v.secrets.some((x) => x.id === c.liar?.secret))
        issues.error('clue-liar-secret', `villager "${v.id}" has no secret "${c.liar.secret}"`, {
          file: sources.mysteries?.[m.id],
          entity: `mysteries/${m.id}`,
        });
    }
  const fragments = new Map(pack.demons.map((d) => [d.id, new Set(d.fragments.map((f) => f.id))]));
  const walkFx = (fx: unknown, where: { file?: string | undefined; entity: string }): void => {
    if (Array.isArray(fx)) {
      for (const x of fx) walkFx(x, where);
    } else if (fx && typeof fx === 'object') {
      const o = fx as Record<string, unknown>;
      if (typeof o['nameFragment'] === 'string' && typeof o['fragment'] === 'string') {
        if (fragments.get(o['nameFragment'])?.has(o['fragment']) === false)
          issues.error(
            'name-fragment-unknown',
            `demon "${o['nameFragment']}" has no fragment "${o['fragment']}"`,
            where,
          );
      }
      for (const v of Object.values(o)) walkFx(v, where);
    }
  };
  for (const [name, list] of Object.entries(pack)) {
    if (name === 'registry' || name === 'locales' || !Array.isArray(list)) continue;
    for (const e of list as { id: string }[])
      walkFx(e, { file: sources[name as CollectionName]?.[e.id], entity: `${name}/${e.id}` });
  }
  const rules = pack['fear-rules'].find((r) => r.id === 'default');
  const directed = pack.events.some((e) => e.category !== 'set-piece');
  if (directed && !rules) {
    issues.error('fear-rules-missing', 'director events need data/fear-rules "default"', {
      file: undefined,
      entity: 'fear-rules/default',
    });
  }
  if (!rules) return;
  const where = { file: sources['fear-rules']?.[rules.id], entity: `fear-rules/${rules.id}` };
  for (const stat of [rules.hysteria.suspicionStat, rules.hysteria.guardianStat]) {
    const want = stat === rules.hysteria.suspicionStat ? 'villager' : 'guardian';
    if (scope.has(stat) && scope.get(stat) !== want)
      issues.error('fear-rules-stat-scope', `stat "${stat}" must be ${want}-scoped`, where);
  }
}

export function validateMisc(pack: ContentPack, sources: SourceMap, issues: IssueList): void {
  validateFear(pack, sources, issues);
  for (const b of pack.buildings) {
    const where = { file: sources.buildings?.[b.id], entity: `buildings/${b.id}` };
    b.levels.forEach((l, i) => {
      if (l.level !== i + 1)
        issues.error('building-levels-order', 'levels must be 1, 2, 3… in order', where);
    });
  }
  for (const d of pack.demons) {
    const where = { file: sources.demons?.[d.id], entity: `demons/${d.id}` };
    const stages = d.symptoms.map((s) => s.stage);
    if (new Set(stages).size !== stages.length)
      issues.error('demon-duplicate-stage', 'one symptom per stage', where);
    if (stages.some((s) => s > d.maxStage)) {
      issues.error(
        'demon-stage-above-max',
        `symptom stage above maxStage ${String(d.maxStage)}`,
        where,
      );
    }
    if (d.rank >= 2 && !d.seal)
      issues.error('demon-seal-missing', 'named demons (rank ≥ 2) need a seal', where);
  }
  for (const z of pack.zones) {
    const where = { file: sources.zones?.[z.id], entity: `zones/${z.id}` };
    const ids = z.variants.map((v) => v.id);
    if (new Set(ids).size !== ids.length)
      issues.error('zone-duplicate-variant', 'variant ids must be unique', where);
    if (!ids.includes(z.defaultVariant)) {
      issues.error(
        'zone-default-variant',
        `defaultVariant "${z.defaultVariant}" is not a variant`,
        where,
      );
    }
    validateZoneGraph(z, where, issues);
  }
  for (const p of pack.pacts) {
    const where = { file: sources.pacts?.[p.id], entity: `pacts/${p.id}` };
    for (const c of p.hiddenClauses) {
      if ('delayNights' in c.trigger && c.trigger.delayNights.min > c.trigger.delayNights.max) {
        issues.error('pact-delay-range', `clause "${c.id}": delay min > max`, where);
      }
    }
  }
  for (const s of pack['seasonal-events']) {
    const where = { file: sources['seasonal-events']?.[s.id], entity: `seasonal-events/${s.id}` };
    for (const md of [s.window.start, s.window.end]) {
      if (!validMonthDay(md))
        issues.error('seasonal-invalid-date', `"${md}" is not a calendar date`, where);
    }
  }
  for (const v of pack.villagers) {
    const where = { file: sources.villagers?.[v.id], entity: `villagers/${v.id}` };
    if (v.relationships.some((r) => r.villager === v.id)) {
      issues.error(
        'villager-self-relationship',
        'a villager cannot have a relationship with themself',
        where,
      );
    }
  }
  validateVillage(pack, sources, issues);
  validateItems(pack, sources, issues);
}

/** Items, recipes, cursed objects, photo layers and the item rules (docs/systems/inventory.md). */
function validateItems(pack: ContentPack, sources: SourceMap, issues: IssueList): void {
  const items = new Map(pack.items.map((i) => [i.id, i]));
  const at = (collection: keyof SourceMap, id: string): Where => ({
    file: sources[collection]?.[id],
    entity: `${collection}/${id}`,
  });
  // Every cursed object is embodied by exactly one unique item.
  for (const c of pack['cursed-objects']) {
    const holders = pack.items.filter((i) => i.cursed === c.id);
    if (holders.length !== 1)
      issues.error(
        'cursed-item',
        `cursed object "${c.id}" needs exactly one item with "cursed": "${c.id}" (found ${String(holders.length)})`,
        at('cursed-objects', c.id),
      );
    for (const h of holders)
      if (!h.unique)
        issues.error(
          'cursed-item',
          `item "${h.id}" embodies a cursed object: make it unique`,
          at('items', h.id),
        );
  }
  // Recipes are found by their exact inputs: no item twice, no two recipes with the same inputs.
  const signatures = new Map<string, string>();
  for (const r of pack.recipes) {
    const ids = r.inputs.map((i) => i.item);
    if (new Set(ids).size !== ids.length)
      issues.error('recipe-inputs', 'an input item appears twice', at('recipes', r.id));
    const sig = [...r.inputs]
      .sort((a, b) => a.item.localeCompare(b.item))
      .map((i) => `${i.item}×${String(i.qty)}`)
      .join('+');
    const other = signatures.get(sig);
    if (other)
      issues.error('recipe-inputs', `same inputs as recipe "${other}"`, at('recipes', r.id));
    signatures.set(sig, r.id);
  }
  for (const l of pack['photo-layers'])
    if ('poi' in l.target) {
      const { zone, poi } = l.target;
      if (!pack.zones.find((z) => z.id === zone)?.pois.some((p) => p.id === poi))
        issues.error(
          'photo-layer-poi',
          `"${poi}" is not a POI of "${zone}"`,
          at('photo-layers', l.id),
        );
    }
  validateProgression(pack, sources, issues);
  validateQuests(pack, sources, issues);
  if (pack.items.length === 0) return;
  const rules = pack['item-rules'].find((r) => r.id === 'default');
  if (!rules) {
    issues.error('item-rules-missing', 'items need data/item-rules "default"', {
      file: undefined,
      entity: 'item-rules/default',
    });
    return;
  }
  const where = at('item-rules', rules.id);
  if (items.get(rules.photography.camera)?.unique === false)
    issues.error('item-rules-camera', 'the camera item must be unique', where);
}

/** Places, routines, tasks and the village rules (docs/systems/villagers.md, tasks.md). */
function validateVillage(pack: ContentPack, sources: SourceMap, issues: IssueList): void {
  const rulesList = pack['village-rules'];
  if (pack.villagers.length === 0) return;
  const rules = rulesList.find((r) => r.id === 'default');
  if (!rules) {
    issues.error('village-rules-missing', 'villagers need data/village-rules "default"', {
      file: undefined,
      entity: 'village-rules/default',
    });
    return;
  }
  const zone = pack.zones.find((z) => z.id === rules.zone);
  const pois = new Map((zone?.pois ?? []).map((p) => [p.id, p]));
  const rulesWhere = {
    file: sources['village-rules']?.[rules.id],
    entity: `village-rules/${rules.id}`,
  };
  if (!pois.has(rules.death.grave))
    issues.error(
      'village-place',
      `grave "${rules.death.grave}" is not a POI of "${rules.zone}"`,
      rulesWhere,
    );
  if (!pois.has(rules.possession.sleepwalkPlace))
    issues.error(
      'village-place',
      `sleepwalk place "${rules.possession.sleepwalkPlace}" is not a POI of "${rules.zone}"`,
      rulesWhere,
    );
  const place = (id: string, what: string, where: Where, allow: readonly string[]): void => {
    if (allow.includes(id) || pois.has(id)) return;
    issues.error('village-place', `${what} "${id}" is not a POI of zone "${rules.zone}"`, where);
  };
  for (const v of pack.villagers) {
    const where = { file: sources.villagers?.[v.id], entity: `villagers/${v.id}` };
    place(v.home, 'home', where, []);
    if (pois.has(v.home) && pois.get(v.home)?.kind !== 'house')
      issues.error('villager-home', `home "${v.home}" is not a house`, where);
    place(v.work, 'work place', where, []);
    const routine = pack.routines.find((r) => r.id === v.routine);
    if (routine && routine.priority > 0)
      issues.error(
        'villager-routine',
        `base routine "${v.routine}" is an override (priority > 0)`,
        where,
      );
  }
  for (const t of pack.tasks) {
    const where = { file: sources.tasks?.[t.id], entity: `tasks/${t.id}` };
    place(t.place, 'task place', where, ['home']);
    if (t.slot === 'day' && t.output.length === 0)
      issues.error('task-no-output', 'a day task needs an output', where);
    if (t.slot === 'night' && t.defence === 0 && t.output.length === 0)
      issues.error('task-no-output', 'a night task needs a defence or an output', where);
  }
  for (const r of pack.routines) {
    const where = { file: sources.routines?.[r.id], entity: `routines/${r.id}` };
    r.blocks.forEach((b, i) => {
      place(b.place, 'place', { ...where, path: `blocks[${String(i)}]` }, ['home', 'work']);
      const prev = r.blocks[i - 1];
      if (prev && prev.at >= b.at)
        issues.error(
          'routine-order',
          `block ${String(i)} (${b.at}) is not after ${prev.at}`,
          where,
        );
    });
    if (r.priority === 0 && (r.villagers || r.days || r.when || r.window))
      issues.error(
        'routine-base-filter',
        'only overrides (priority > 0) take villagers/days/window/when',
        where,
      );
  }
}

/** Guardian progression (docs/systems/progression.md): rules file, tags, sins, milestones. */
export function validateProgression(
  pack: ContentPack,
  sources: SourceMap,
  issues: IssueList,
): void {
  const at = (collection: CollectionName, id: string) => ({
    file: sources[collection]?.[id],
    entity: `${collection}/${id}`,
  });
  if (pack.callings.length > 0 && !pack['progression-rules'].some((r) => r.id === 'default'))
    issues.error('progression-rules-missing', 'callings need data/progression-rules "default"', {
      file: undefined,
      entity: 'progression-rules/default',
    });
  const rules = pack['progression-rules'].find((r) => r.id === 'default');
  if (rules) {
    const a = rules.attributes;
    if (!(a.base <= a.creationMax && a.creationMax <= a.cap && a.cap <= a.absoluteMax))
      issues.error(
        'progression-attributes',
        'expected base ≤ creationMax ≤ cap ≤ absoluteMax',
        at('progression-rules', rules.id),
      );
    if (rules.debt.major >= rules.debt.grave)
      issues.error(
        'progression-debt',
        'major must be below grave',
        at('progression-rules', rules.id),
      );
  }
  const virtues = new Set(pack.virtues.map((v) => v.id));
  const sins = new Set(pack.sins.map((s) => s.id));
  for (const tone of pack['talk-tones'])
    for (const tag of tone.tags) {
      const [kind, id = ''] = tag.split(':');
      if (!(kind === 'virtue' ? virtues : sins).has(id))
        issues.error('talk-tone-tag', `unknown ${String(kind)} "${id}"`, at('talk-tones', tone.id));
    }
  for (const sin of pack.sins)
    for (const v of sin.blocks)
      if (!virtues.has(v)) issues.error('sin-blocks', `unknown virtue "${v}"`, at('sins', sin.id));
  // Creditors with debt sources must have something to collect at the minor tier.
  const creditors = new Set(pack['debt-sources'].map((s) => s.creditor));
  for (const c of creditors)
    if (
      pack['debt-collections'].length > 0 &&
      !pack['debt-collections'].some((d) => d.creditor === c && d.severity === 'minor')
    )
      issues.warn('debt-collection-missing', `creditor "${c}" has no minor collection`, {
        file: undefined,
        entity: `debt-collections`,
      });
}

/** Quests (docs/systems/quests.md → Implementation): exclusions and map markers. */
export function validateQuests(pack: ContentPack, sources: SourceMap, issues: IssueList): void {
  for (const q of pack.quests) {
    const where = { file: sources.quests?.[q.id], entity: `quests/${q.id}` };
    if (q.excludes.includes(q.id))
      issues.error('quest-excludes-self', 'a quest cannot exclude itself', where);
    for (const stage of q.stages)
      for (const o of stage.objectives)
        if (
          o.marker &&
          !pack.zones.find((z) => z.id === o.marker?.zone)?.pois.some((p) => p.id === o.marker?.poi)
        )
          issues.error(
            'quest-marker',
            `"${o.marker.poi}" is not a POI of "${o.marker.zone}"`,
            where,
          );
  }
}
