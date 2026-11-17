import { describe, expect, it } from 'vitest';
import { validatePack } from '../validate';
import { IssueList } from '../validate/issues';
import { CONTENT_ROOT, realPack } from '../test-helpers';
import { compileAll, compileInk, loadInk } from './ink';

const stories = loadInk(CONTENT_ROOT);
const codes = (ink: Record<string, string>) =>
  validatePack({ ...realPack(), ink })
    .issues.filter((i) => i.severity === 'error')
    .map((i) => i.code);

describe('ink stories (docs/systems/dialogue.md → Implementation)', () => {
  it('the 8 villagers, the forest spirit and the prologue have stories that compile and validate', () => {
    expect(Object.keys(stories).sort()).toEqual([
      'baba-neda',
      'chorbadzhi-dimo',
      'forest-spirit',
      'krastyo',
      'petko',
      'pop-stoyan',
      'prologue-accusation',
      'prologue-byre',
      'prologue-crossroads',
      'prologue-home',
      'prologue-neighbour',
      'prologue-pyre',
      'prologue-trial',
      'radka',
      'todor',
      'velika',
    ]);
    const issues = new IssueList();
    compileAll(stories, issues);
    expect(issues.items).toEqual([]);
    expect(codes(stories)).toEqual([]);
  });

  it('fails on a flag that flags.json does not declare (CI)', () => {
    const ink = { ...stories, bad: 'EXTERNAL set_flag(id)\n~ set_flag("not-declared")\n-> END\n' };
    expect(codes(ink)).toContain('ink-unknown-id');
    const tag = { ...stories, bad: 'Hi.\n* [Go #requires:flag:nope] Gone.\n- -> END\n' };
    expect(codes(tag)).toContain('ink-unknown-id');
  });

  it('fails on externals outside the whitelist, unknown tags and missing stories', () => {
    expect(codes({ ...stories, bad: 'EXTERNAL delete_save()\n-> END\n' })).toContain(
      'ink-external',
    );
    expect(codes({ ...stories, bad: 'Hi. #explode\n-> END\n' })).toContain('ink-tag');
    const { 'forest-spirit': _gone, ...rest } = stories;
    expect(codes(rest)).toContain('ink-missing-story');
  });

  it('reports compile errors', () => {
    expect(compileInk('* [Unclosed\n-> nowhere\n').errors.length).toBeGreaterThan(0);
    expect(compileInk('Hello.\n-> END\n').json).toContain('Hello.');
  });
});
