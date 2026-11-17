import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkManifest } from '../node/fs';
import { CONTENT_ROOT, codes, errorsOf, mutate, realPack } from '../test-helpers';
import { IssueList, validatePack } from './index';

type Json = Record<string, unknown>;
type Node = { cell: string; requires?: string[]; tier?: string; cost?: number };

function nodesOf(tree: Json): Node[] {
  return tree['nodes'] as Node[];
}

describe('sample content pack', () => {
  it('is valid', () => {
    const result = validatePack(realPack());
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('contains the requested MVP sample', () => {
    const { pack } = validatePack(realPack());
    expect(pack.villagers).toHaveLength(8);
    expect(pack.demons).toHaveLength(3);
    expect(pack.mysteries.map((m) => m.id)).toEqual(['girl-without-a-shadow', 'wasting-bride']);
    // The 15 MVP achievements (achievements.md) + 3 fed by the collection (collection.md).
    expect(pack.achievements).toHaveLength(18);
    expect(pack.callings.map((c) => c.id).sort()).toEqual(['priests-acolyte', 'znaharka']);
    expect(pack.trees.filter((t) => t.kind === 'calling')).toHaveLength(4);
    expect(pack.trees.filter((t) => t.kind === 'dark')).toHaveLength(1);
    expect(pack.buildings.filter((b) => b.tier === 'demo')).toHaveLength(3);
    expect(
      pack['bloodline-nodes'].filter((n) => n.tier === 'demo').every((n) => n.level === 1),
    ).toBe(true);
  });

  it('has an up-to-date manifest', () => {
    const issues = new IssueList();
    checkManifest(CONTENT_ROOT, issues);
    expect(issues.items).toEqual([]);
  });
});

describe('schema errors', () => {
  it('rejects non-kebab-case ids', () => {
    const raw = mutate(realPack(), 'villagers', 'velika', (v) => {
      v['id'] = 'Velika_Weaver';
    });
    expect(codes(raw)).toContain('schema');
  });

  it('rejects an invalid talent effect', () => {
    const raw = mutate(realPack(), 'talents', 'litany', (t) => {
      t['effects'] = [{ modifier: { fateDice: 9 } }];
    });
    expect(errorsOf(raw).some((i) => i.code === 'schema' && i.entity === 'talents/litany')).toBe(
      true,
    );
  });

  it('rejects an effect with a missing field', () => {
    const raw = mutate(realPack(), 'talents', 'absolution', (t) => {
      t['effects'] = [{ addStat: 'corruption' }];
    });
    expect(codes(raw)).toContain('schema');
  });

  it('rejects a stat condition without exactly one comparator', () => {
    const none = mutate(realPack(), 'achievements', 'first-night', (a) => {
      a['condition'] = { stat: 'nights-survived' };
    });
    const two = mutate(realPack(), 'achievements', 'first-night', (a) => {
      a['condition'] = { stat: 'nights-survived', '>=': 1, '<': 3 };
    });
    expect(codes(none)).toContain('schema');
    expect(codes(two)).toContain('schema');
  });

  it('rejects hallucination events that set world flags', () => {
    const raw = mutate(realPack(), 'events', 'stranger-knows-your-name', (e) => {
      e['effects'] = [{ setFlag: 'bell-cracked' }];
    });
    expect(codes(raw)).toContain('schema');
  });

  it('rejects duplicate ids', () => {
    const raw = realPack();
    const entry = raw.collections.villagers?.[0];
    if (!entry) throw new Error('setup');
    raw.collections.villagers?.push({
      file: 'data/villagers/copy.json',
      data: structuredClone(entry.data),
    });
    expect(codes(raw)).toContain('duplicate-id');
  });
});

describe('registry and references', () => {
  it('rejects an undeclared flag', () => {
    const raw = mutate(realPack(), 'achievements', 'prologue', (a) => {
      a['condition'] = { all: [{ flag: 'witch-allied' }, { stat: 'corruption', '>=': 40 }] };
    });
    expect(codes(raw)).toContain('unknown-flag');
  });

  it('rejects an undeclared stat in an effect', () => {
    const raw = mutate(realPack(), 'events', 'knocking', (e) => {
      e['effects'] = [{ addStat: 'luck', value: 1 }];
    });
    expect(codes(raw)).toContain('unknown-stat');
  });

  it('rejects a reference to a missing entity', () => {
    const raw = mutate(realPack(), 'callings', 'znaharka', (c) => {
      c['startingGear'] = [{ item: 'silver-bullet', qty: 1 }];
    });
    expect(codes(raw)).toContain('unknown-item');
  });

  it('rejects a localization key that is not in en.json', () => {
    const raw = mutate(realPack(), 'villagers', 'petko', (v) => {
      v['bioKey'] = 'villager.petko.no-such-text';
    });
    expect(codes(raw)).toContain('missing-loc-key');
  });

  it('requires a villager for villager-scoped stats', () => {
    const raw = mutate(realPack(), 'events', 'knocking', (e) => {
      e['effects'] = [{ addStat: 'fear', value: 5 }];
    });
    expect(codes(raw)).toContain('stat-needs-villager');
  });

  it('rejects undeclared rule params', () => {
    const raw = mutate(realPack(), 'talents', 'read-the-faces', (t) => {
      t['effects'] = [{ rule: 'mark-lies', params: { baseChance: 0.5, alwaysRight: true } }];
    });
    expect(codes(raw)).toContain('unknown-rule-param');
  });

  it('rejects an unknown zone variant', () => {
    const raw = mutate(realPack(), 'mysteries', 'wasting-bride', (m) => {
      const outcomes = m['outcomes'] as { effects: Json[] }[];
      outcomes[1]?.effects.push({ setZoneVariant: 'samodivi-forest', variant: 'frozen' });
    });
    expect(codes(raw)).toContain('unknown-zone-variant');
  });
});

describe('demo / full tiers', () => {
  it('rejects demo content that depends on full content', () => {
    const raw = mutate(realPack(), 'achievements', 'prologue', (a) => {
      a['condition'] = { talent: 'borrowed-strength' };
    });
    expect(codes(raw)).toContain('demo-depends-on-full');
  });

  it('rejects a demo tree node that uses a full-game talent', () => {
    const raw = mutate(realPack(), 'trees', 'exorcist', (t) => {
      const a3 = nodesOf(t).find((n) => n.cell === 'A3');
      if (a3) delete a3.tier;
    });
    expect(codes(raw)).toContain('demo-depends-on-full');
  });

  it('allows full content to depend on demo content', () => {
    const raw = mutate(realPack(), 'achievements', 'theophany', (a) => {
      a['condition'] = { flag: 'prologue-complete' };
    });
    expect(codes(raw)).toEqual([]);
  });
});

describe('specialization trees', () => {
  it('rejects prerequisite cycles', () => {
    const raw = mutate(realPack(), 'trees', 'confessor', (t) => {
      const nodes = nodesOf(t);
      const a2 = nodes.find((n) => n.cell === 'A2');
      const b2 = nodes.find((n) => n.cell === 'B2');
      if (!a2 || !b2) throw new Error('setup');
      a2.requires = ['B2'];
      b2.requires = ['A2'];
    });
    const found = codes(raw);
    expect(found).toContain('tree-cycle');
    expect(found).toContain('tree-unreachable');
  });

  it('rejects unreachable nodes', () => {
    const raw = mutate(realPack(), 'trees', 'folk-healer', (t) => {
      t['nodes'] = nodesOf(t).filter((n) => n.cell !== 'A3');
    });
    const found = codes(raw);
    expect(found).toContain('tree-unknown-prereq');
    expect(found).toContain('tree-unreachable');
  });

  it('rejects row costs that do not increase', () => {
    const raw = mutate(realPack(), 'trees', 'charm-speaker', (t) => {
      t['rowCosts'] = [5, 10, 10, 20];
    });
    expect(codes(raw)).toContain('tree-costs-not-increasing');
  });

  it('rejects a node cost override that breaks row ordering', () => {
    const raw = mutate(realPack(), 'trees', 'exorcist', (t) => {
      const c1 = nodesOf(t).find((n) => n.cell === 'C1');
      if (c1) c1.cost = 12;
    });
    expect(codes(raw)).toContain('tree-costs-not-increasing');
  });

  it('rejects prerequisites in a lower tier', () => {
    const raw = mutate(realPack(), 'trees', 'exorcist', (t) => {
      const a2 = nodesOf(t).find((n) => n.cell === 'A2');
      if (a2) a2.requires = ['A3'];
    });
    expect(codes(raw)).toContain('tree-prereq-below');
  });

  it('requires dark trees to declare corruption and an unlock', () => {
    const raw = mutate(realPack(), 'trees', 'servant-of-the-horned-one', (t) => {
      delete t['unlock'];
      delete t['rowCorruption'];
    });
    const found = codes(raw);
    expect(found).toContain('tree-dark-unlock');
    expect(found).toContain('tree-dark-corruption');
  });
});

describe('mysteries', () => {
  it('requires two solid clues for the true culprit', () => {
    const raw = mutate(realPack(), 'mysteries', 'wasting-bride', (m) => {
      m['clues'] = (m['clues'] as Json[]).filter(
        (c) => c['id'] !== 'm1-ledger' && c['id'] !== 'm1-magiya',
      );
    });
    expect(codes(raw)).toContain('mystery-culprit-unprovable');
  });

  it('requires an exonerating clue for every false suspect', () => {
    const raw = mutate(realPack(), 'mysteries', 'wasting-bride', (m) => {
      m['clues'] = (m['clues'] as Json[]).filter((c) => c['id'] !== 'm1-rope');
    });
    expect(codes(raw)).toContain('mystery-suspect-not-exonerable');
  });

  it('requires an outcome for every suspect', () => {
    const raw = mutate(realPack(), 'mysteries', 'wasting-bride', (m) => {
      m['outcomes'] = (m['outcomes'] as Json[]).filter((o) => o['culprit'] !== 'radka');
    });
    expect(codes(raw)).toContain('mystery-missing-outcome');
  });
});

describe('manifest', () => {
  it('ignores pure reformatting of a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mrak-content-'));
    try {
      cpSync(CONTENT_ROOT, dir, { recursive: true });
      const file = join(dir, 'data/items/items.json');
      writeFileSync(file, JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))));
      const issues = new IssueList();
      checkManifest(dir, issues);
      expect(issues.items).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects files changed after the manifest was written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mrak-content-'));
    try {
      cpSync(CONTENT_ROOT, dir, {
        recursive: true,
        filter: (src) => !src.includes('node_modules'),
      });
      writeFileSync(join(dir, 'data/items/items.json'), '[]\n');
      const issues = new IssueList();
      checkManifest(dir, issues);
      expect(issues.items.map((i) => i.code)).toContain('manifest-stale');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
