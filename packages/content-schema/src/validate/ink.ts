/**
 * Static checks of Ink stories (docs/systems/dialogue.md → Implementation): only whitelisted
 * external functions; every flag, stat, item, skill and villager id they name exists; choice tags
 * are known; content `dialogue` refs name existing stories. Browser-safe (no compiler here: the
 * Node CLI compiles, see node/ink.ts).
 */
import type { ContentPack, SourceMap } from '../pack';
import type { IssueList } from './issues';

/** External functions Ink may call (all writes become validated core commands). */
export const INK_EXTERNALS = [
  'get_flag',
  'set_flag',
  'get_stat',
  'add_stat',
  'has_item',
  'give_item',
  'skill_level',
  'villager_state',
  'record_decision',
] as const;
export type InkExternal = (typeof INK_EXTERNALS)[number];

/** Choice nature tags (shown as icons). */
export const CHOICE_NATURES = ['empathy', 'threat', 'lie', 'occult'] as const;
export type ChoiceNature = (typeof CHOICE_NATURES)[number];

const LINE_TAGS = ['shake', 'whisper', 'noSinTakeover'];
const PREFIX_TAGS = ['sfx', 'speaker', 'virtue', 'sin', 'requires'];

/** Which kind of id the first string argument of each external names. */
const ARG_KIND: Partial<Record<InkExternal, 'flag' | 'stat' | 'item' | 'skill' | 'villager'>> = {
  get_flag: 'flag',
  set_flag: 'flag',
  get_stat: 'stat',
  add_stat: 'stat',
  has_item: 'item',
  give_item: 'item',
  skill_level: 'skill',
  villager_state: 'villager',
};

export interface InkUsage {
  externals: string[];
  /** [kind, id] pairs named by external calls and `#requires:` tags. */
  ids: ['flag' | 'stat' | 'item' | 'skill' | 'villager', string][];
  tags: string[];
}

/** Removes `/* … *\/` comments in linear time (an unterminated one runs to the end). */
function stripBlockComments(source: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = source.indexOf('/*', at);
    if (open < 0) return out + source.slice(at);
    out += source.slice(at, open);
    const close = source.indexOf('*/', open + 2);
    if (close < 0) return out;
    at = close + 2;
  }
}

/** What a story uses (by scanning its source; comments are ignored). */
export function scanInk(source: string): InkUsage {
  const text = stripBlockComments(source).replace(/\/\/.*$/gm, '');
  const externals = [...text.matchAll(/^\s*EXTERNAL\s+([A-Za-z_]\w*)/gm)].map((m) => m[1] ?? '');
  const ids: InkUsage['ids'] = [];
  for (const m of text.matchAll(/\b([a-z_]+)\(\s*"([^"]*)"/g)) {
    const kind = ARG_KIND[m[1] as InkExternal];
    if (kind) ids.push([kind, m[2] ?? '']);
  }
  const tags = [...text.matchAll(/#\s*([A-Za-z][\w:.-]*)/g)].map((m) => m[1] ?? '');
  for (const tag of tags) {
    const [head, kind, id] = tag.split(':');
    if (head !== 'requires' || !kind || !id) continue;
    if (kind === 'flag' || kind === 'item' || kind === 'skill' || kind === 'stat')
      ids.push([kind, id]);
  }
  return { externals, ids, tags };
}

export function validateInk(
  pack: ContentPack,
  sources: SourceMap,
  stories: Readonly<Record<string, string>>,
  issues: IssueList,
): void {
  const known = {
    flag: new Set(pack.registry.flags.map((f) => f.id)),
    stat: new Set(pack.registry.stats.map((s) => s.id)),
    item: new Set(pack.items.map((i) => i.id)),
    skill: new Set(pack.skills.map((s) => s.id)),
    villager: new Set([...pack.villagers.map((v) => v.id), 'guardian']),
  };
  const virtues = new Set(pack.virtues.map((v) => v.id));
  const sins = new Set(pack.sins.map((s) => s.id));
  for (const [id, source] of Object.entries(stories)) {
    const file = `ink/${id}.ink`;
    const usage = scanInk(source);
    for (const name of usage.externals)
      if (!(INK_EXTERNALS as readonly string[]).includes(name))
        issues.error('ink-external', `external function "${name}" is not in the whitelist`, {
          file,
        });
    for (const [kind, ref] of usage.ids)
      if (!known[kind].has(ref)) {
        const hint = kind === 'flag' ? ' (declare it in data/flags.json "flags")' : '';
        issues.error('ink-unknown-id', `unknown ${kind} "${ref}"${hint}`, { file });
      }
    for (const tag of usage.tags) {
      const [head = '', value = ''] = tag.split(':');
      if (LINE_TAGS.includes(tag) || (CHOICE_NATURES as readonly string[]).includes(tag)) continue;
      if (!PREFIX_TAGS.includes(head) || value === '') {
        issues.error('ink-tag', `unknown tag "#${tag}"`, { file });
        continue;
      }
      if (head === 'virtue' && !virtues.has(value))
        issues.error('ink-tag', `unknown virtue "${value}"`, { file });
      if (head === 'sin' && !sins.has(value))
        issues.error('ink-tag', `unknown sin "${value}"`, { file });
      if (head === 'sfx' && !(`sfx.${value}` in pack.locales.en))
        issues.error('ink-tag', `sound "${value}" needs the caption key "sfx.${value}"`, { file });
      if (head === 'speaker' && !known.villager.has(value))
        issues.error('ink-tag', `unknown speaker "${value}"`, { file });
      if (head === 'requires' && !['flag', 'item', 'skill', 'stat'].includes(value))
        issues.error('ink-tag', `unknown requirement "#${tag}"`, { file });
    }
  }
  const named = [
    ...pack.villagers.flatMap((v) =>
      v.dialogue
        ? [{ story: v.dialogue, file: sources.villagers?.[v.id], entity: `villagers/${v.id}` }]
        : [],
    ),
    ...pack.zones.flatMap((z) =>
      z.pois.flatMap((p) =>
        p.dialogue
          ? [{ story: p.dialogue, file: sources.zones?.[z.id], entity: `zones/${z.id}` }]
          : [],
      ),
    ),
  ];
  for (const n of named)
    if (!(n.story in stories))
      issues.error('ink-missing-story', `no story ink/${n.story}.ink`, {
        file: n.file,
        entity: n.entity,
      });
}
