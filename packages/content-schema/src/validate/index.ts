import type { ContentPack, RawPack, SourceMap } from '../pack';
import { IssueList, type Issue } from './issues';
import { validateMaps } from './maps';
import { parsePack } from './parse';
import { buildRefIndex, validateRefs } from './refs';
import { validateBloodline, validateCallings, validateMisc, validateMysteries } from './rules';
import { validateInk } from './ink';
import { validateTree } from './trees';

export interface ValidationResult {
  pack: ContentPack;
  sources: SourceMap;
  issues: Issue[];
  ok: boolean;
}

/** Parses and validates a whole content pack. `ok` is false if any error was found. */
export function validatePack(raw: RawPack): ValidationResult {
  const issues = new IssueList();
  const { pack, sources } = parsePack(raw, issues);
  const index = buildRefIndex(pack);
  validateRefs(pack, sources, index, issues);
  const talentTiers = new Map(pack.talents.map((t) => [t.id, t.tier]));
  for (const tree of pack.trees) validateTree(tree, sources, issues, talentTiers);
  validateMysteries(pack, sources, issues);
  validateCallings(pack, sources, issues);
  validateBloodline(pack, sources, issues);
  validateMisc(pack, sources, issues);
  if (raw.maps) validateMaps(pack, sources, raw.maps, issues);
  if (raw.ink) validateInk(pack, sources, raw.ink, issues);
  return { pack, sources, issues: issues.items, ok: issues.errors.length === 0 };
}

export { formatIssue, IssueList, type Issue, type Severity } from './issues';
export {
  CHOICE_NATURES,
  INK_EXTERNALS,
  scanInk,
  type ChoiceNature,
  type InkExternal,
  type InkUsage,
} from './ink';
export { parseCell, nodeCost } from './trees';
