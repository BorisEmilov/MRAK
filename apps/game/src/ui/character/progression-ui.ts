/**
 * Pure helpers of the character sheet, talent trees, check results and journal
 * (docs/systems/progression.md): plain-language labels for every die, refusal reasons, tree grid
 * layout and journal entries.
 */
import type { LocaleKey } from '@mrak/content';
import type { SpecializationTree } from '@mrak/content-schema';
import type {
  CheckResult,
  ContentDatabase,
  GuardianChoices,
  Omen,
  PoolPart,
  Snapshot,
} from '@mrak/core';
import type { IconName } from '@mrak/ui-kit';

export type Translate = (
  key: LocaleKey,
  params?: Readonly<Record<string, string | number>>,
) => string;

const nameOf = (
  db: ContentDatabase,
  collection: 'talents' | 'gear' | 'blessings' | 'cursed-objects' | 'cabinet-sets' | 'callings',
  id: string,
  t: Translate,
): string => {
  const e = db.find(collection, id) as { nameKey?: string } | undefined;
  return e?.nameKey ? t(e.nameKey as LocaleKey) : id;
};

/** Plain-language label of one reason the pool has its dice (UI rule 15). */
export function partLabel(source: string, db: ContentDatabase, t: Translate): string {
  if (source.startsWith('debt:'))
    return t('check.part.debt', { source: partLabel(source.slice(5), db, t) });
  const [kind = '', rest = ''] = source.split(/:(.*)/s);
  const [a = '', b = ''] = rest.split('/');
  switch (kind) {
    case 'attribute':
      return t(`attribute.${rest}.name` as LocaleKey);
    case 'skill':
      return t('check.part.skill', { skill: t(`skill.${rest}.name` as LocaleKey) });
    case 'difficulty':
      return t('check.part.difficulty', { difficulty: t(`check.difficulty.${rest}` as LocaleKey) });
    case 'talent': {
      const node = db.find('trees', a)?.nodes.find((n) => n.cell === b);
      return node ? nameOf(db, 'talents', node.talent, t) : rest;
    }
    case 'gear':
      return nameOf(db, 'gear', rest, t);
    case 'upgrade': {
      const up = db.find('gear', a)?.upgrades.find((u) => u.id === b);
      return up ? t(up.nameKey as LocaleKey) : rest;
    }
    case 'blessing':
      return t('check.part.blessing', {
        blessing: nameOf(db, 'blessings', b, t),
        gear: nameOf(db, 'gear', a, t),
      });
    case 'cursed':
      return nameOf(db, 'cursed-objects', rest, t);
    case 'cabinet':
      return nameOf(db, 'cabinet-sets', rest, t);
    case 'calling':
      return nameOf(db, 'callings', rest, t);
    case 'state':
      return t(`check.part.${rest}` as LocaleKey);
    case 'virtue':
      return t('check.part.boon');
    default:
      return source === 'virtuous' ? t('check.part.virtuous') : t('check.part.other');
  }
}

/** "+2 Fate", "−1 Shadow", "+1 Fate, +1 Shadow". */
export function partDice(part: PoolPart, t: Translate): string {
  const signed = (n: number) => (n > 0 ? `+${String(n)}` : `−${String(-n)}`);
  const out: string[] = [];
  if (part.fate !== 0) out.push(t('check.fate-dice', { n: signed(part.fate) }));
  if (part.shadow !== 0) out.push(t('check.shadow-dice', { n: signed(part.shadow) }));
  return out.join(', ');
}

export function omenKey(omen: Omen): LocaleKey {
  return `check.omen.${omen}` as LocaleKey;
}

export function omenIcon(omen: Omen): IconName {
  return omen === 'great'
    ? 'check.great'
    : omen === 'dire'
      ? 'check.dire'
      : omen === 'good'
        ? 'check.sun'
        : omen === 'bad'
          ? 'check.moon'
          : 'omen.none';
}

/** Symbols on a die face, for the result view. */
export function faceSymbols(kind: 'fate' | 'shadow', face: number): IconName[] {
  if (kind === 'fate')
    return [
      ...(face >= 4 ? (['check.success'] as const) : []),
      ...(face === 3 || face === 6 ? (['check.sun'] as const) : []),
    ];
  return [
    ...(face >= 4 ? (['check.failure'] as const) : []),
    ...(face === 3 || face === 6 ? (['check.moon'] as const) : []),
  ];
}

/** Summary line of a result: "Success · good omen". */
export function resultTitle(r: CheckResult, t: Translate): string {
  return t('check.result', {
    result: t(r.success ? 'check.success' : 'check.failure'),
    omen: t(omenKey(r.omen)),
  });
}

/** Locale key of a progression refusal reason. */
export function progressionReasonKey(reason: string): LocaleKey {
  const known: Record<string, LocaleKey> = {
    'not at night': 'progression.reason.night',
    'not enough revelation': 'progression.reason.revelation',
    'attribute at its maximum': 'progression.reason.attribute-max',
    'cap at its maximum': 'progression.reason.cap-max',
    'prerequisite missing': 'progression.reason.prerequisite',
    'tree not owned': 'progression.reason.tree',
    'already owned': 'progression.reason.owned',
    'opened by a pact': 'progression.reason.pact-only',
    'nothing owed': 'progression.reason.nothing-owed',
    'cannot pay now': 'progression.reason.cannot-pay',
    'not here': 'progression.reason.not-here',
    'not at this hour': 'progression.reason.hour',
    'already signed': 'progression.reason.signed',
    'not safe here': 'progression.reason.unsafe',
    'wrong slot': 'progression.reason.wrong-slot',
    'not owned': 'progression.reason.not-owned',
    'no free slot': 'progression.reason.no-slot',
    'wrong place': 'progression.reason.wrong-place',
    'missing materials': 'progression.reason.materials',
    'wrong gear': 'progression.reason.wrong-gear',
    'workshop closed': 'progression.reason.workshop',
    'already done': 'progression.reason.done',
    'journal full': 'progression.reason.journal-full',
    'note too long': 'progression.reason.note-long',
    'empty note': 'progression.reason.note-empty',
    'your sin will not allow it': 'progression.reason.sin',
    'tone not available': 'progression.reason.other',
  };
  return known[reason] ?? 'progression.reason.other';
}

export interface GridNode {
  cell: string;
  col: number;
  row: number;
  talent: string;
  requires: readonly string[];
}

/** Tree nodes placed on the grid (columns × rows), in reading order. */
export function treeGrid(tree: SpecializationTree): {
  columns: number;
  rows: number;
  nodes: GridNode[];
} {
  const nodes = tree.nodes
    .map((n) => ({
      cell: n.cell,
      col: n.cell.charCodeAt(0) - 65,
      row: Number(n.cell.slice(1)) - 1,
      talent: n.talent,
      requires: n.requires,
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  return { columns: tree.columns, rows: tree.rowCosts.length, nodes };
}

/** The cell reached by an arrow key from `cell` (keyboard navigation of the grid). */
export function moveInGrid(
  nodes: readonly GridNode[],
  cell: string,
  dx: number,
  dy: number,
): string {
  const from = nodes.find((n) => n.cell === cell);
  if (!from) return nodes[0]?.cell ?? cell;
  const candidates = nodes.filter((n) =>
    dx !== 0
      ? n.row === from.row && Math.sign(n.col - from.col) === dx
      : Math.sign(n.row - from.row) === dy,
  );
  candidates.sort(
    (a, b) =>
      Math.abs(a.col - from.col) +
      Math.abs(a.row - from.row) * 2 -
      (Math.abs(b.col - from.col) + Math.abs(b.row - from.row) * 2),
  );
  return candidates[0]?.cell ?? cell;
}

/** "Seen by demons" in words: the number stays hidden (progression.md §10). */
export function noticeKey(notice: number): LocaleKey {
  if (notice >= 75) return 'character.notice.4';
  if (notice >= 50) return 'character.notice.3';
  if (notice >= 25) return 'character.notice.2';
  if (notice > 0) return 'character.notice.1';
  return 'character.notice.0';
}

export interface JournalEntry {
  /** Heir mark key ("clue:x", "demon:y", "recipe:z", "person:v", "note:3"). */
  key: string;
  title: string;
  body?: string | undefined;
}

/** Entries of a journal tab (docs/systems/progression.md J1). */
export function journalEntries(
  tab: 'clues' | 'demons' | 'bestiary' | 'recipes' | 'people',
  s: Snapshot,
  db: ContentDatabase,
  t: Translate,
): JournalEntry[] {
  switch (tab) {
    case 'clues':
      return Object.entries(s.mysteries).flatMap(([id, m]) => {
        const mystery = db.find('mysteries', id);
        return m.clues.map((clue) => {
          const def = mystery?.clues.find((c) => c.id === clue);
          return {
            key: `clue:${clue}`,
            title: def ? t(def.nameKey as LocaleKey) : clue,
            body: def ? t(def.descKey as LocaleKey) : undefined,
          };
        });
      });
    case 'demons': {
      const learned = s.journal.learned
        .filter((e) => e.startsWith('demon:'))
        .map((e) => e.slice(6));
      const revealed = s.possessions.filter((p) => p.revealed).map((p) => p.demon);
      return [...new Set([...learned, ...revealed])].map((id) => {
        const d = db.find('demons', id);
        return {
          key: `demon:${id}`,
          title: d ? t(d.nameKey as LocaleKey) : id,
          body: d ? t(d.loreKey as LocaleKey) : undefined,
        };
      });
    }
    case 'bestiary':
      return s.journal.learned
        .filter((e) => e.startsWith('creature:'))
        .map((e) => {
          const c = db.find('creatures', e.slice(9));
          return {
            key: e,
            title: c ? t(c.nameKey as LocaleKey) : e,
            body: c ? t(c.descKey as LocaleKey) : undefined,
          };
        });
    case 'recipes':
      return s.guardian.unlockedRecipes.map((id) => {
        const r = db.find('recipes', id);
        return {
          key: `recipe:${id}`,
          title: r ? t(r.nameKey as LocaleKey) : id,
          body: r ? t(r.descKey as LocaleKey) : undefined,
        };
      });
    case 'people':
      return db
        .all('villagers')
        .filter(
          (v) =>
            s.collection.talked[v.id] !== undefined || (s.villagers[v.id]?.secrets.length ?? 0) > 0,
        )
        .map((v) => ({
          key: `person:${v.id}`,
          title: t(v.nameKey as LocaleKey),
          body: t('journal.people.affinity', {
            value: Math.round(s.villagers[v.id]?.affinity['guardian'] ?? 0),
          }),
        }));
  }
}

/** The calling's suggested choices (first native tree, a bonus attribute, default virtue and sin). */
export function defaultChoices(db: ContentDatabase, calling?: string): GuardianChoices {
  const c = (calling ? db.find('callings', calling) : undefined) ?? db.all('callings')[0];
  return {
    calling: c?.id ?? '',
    tree: c?.trees[0] ?? '',
    bonus: c?.attributeBonuses[0] ?? db.all('attributes')[0]?.id ?? '',
    virtue: c?.defaultVirtue ?? '',
    sin: c?.defaultSin ?? '',
  };
}
