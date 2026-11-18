/**
 * Content analysis (docs/systems/studio.md → Analysis): validation issues, flags nobody sets or
 * reads, possibly unreachable content, the quest/event/mystery/pact graph, villager relations and
 * mystery clues.
 */
import {
  collectRefs,
  COLLECTIONS,
  validatePack,
  type CollectionName,
  type RawPack,
} from '@mrak/content-schema';

const GRAPH = ['quests', 'events', 'mysteries', 'pacts'] as const;
const GRAPH_KINDS: Record<string, string> = {
  quest: 'quests',
  event: 'events',
  mystery: 'mysteries',
  pact: 'pacts',
};

interface Ref {
  collection: string;
  id: string;
  path: string;
}

export interface Finding {
  code: 'flag-never-set' | 'flag-never-read' | 'flag-unused' | 'maybe-unreachable';
  flag: string;
  message: string;
  readers?: Ref[];
  setters?: Ref[];
  entity?: Ref;
}

export interface Analysis {
  issues: { severity: string; code: string; message: string; file?: string | undefined }[];
  findings: Finding[];
  graph: {
    nodes: { id: string; collection: string; label: string }[];
    edges: { from: string; to: string; label: string; kind: 'flag' | 'ref' }[];
  };
  villagers: {
    id: string;
    name: string;
    home: unknown;
    work: unknown;
    secrets: unknown;
    relationships: { villager: string; affinity: number }[];
  }[];
  mysteries: {
    id: string;
    name: string;
    suspects: unknown;
    clues: { id: string; name: string; sources: unknown; supports: unknown; refutes: unknown }[];
  }[];
}

type Obj = Record<string, unknown>;
const asList = (data: unknown): Obj[] =>
  (Array.isArray(data) ? data : [data]).filter(
    (x): x is Obj => typeof x === 'object' && x !== null,
  );

const INK_SET = /\bset_flag\(\s*"([a-z0-9-]+)"/g;
const INK_READ = /\b(?:has_flag|flag)\(\s*"([a-z0-9-]+)"/g;

export function analyse(raw: RawPack): Analysis {
  const en = raw.locales.en.data as Record<string, string>;
  const text = (key: unknown, fallback: string) =>
    typeof key === 'string' ? (en[key] ?? fallback) : fallback;

  const entities: { collection: CollectionName; body: Obj }[] = [];
  for (const [c, list] of Object.entries(raw.collections))
    for (const entry of list)
      for (const body of asList(entry.data))
        entities.push({ collection: c as CollectionName, body });

  const setters = new Map<string, Ref[]>();
  const readers = new Map<string, (Ref & { negated: boolean })[]>();
  const add = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  const refsOf = new Map<string, { kind: string; id: string; path: string }[]>();

  for (const { collection, body } of entities) {
    const id = String(body['id']);
    const refs = collectRefs(COLLECTIONS[collection].schema, body);
    refsOf.set(`${collection}/${id}`, refs);
    for (const r of refs) {
      if (r.kind !== 'flag') continue;
      const ref = { collection, id, path: r.path };
      if (/(^|\.)setFlag$/.test(r.path)) add(setters, r.id, ref);
      else if (/(^|\.)clearFlag$/.test(r.path)) continue;
      else add(readers, r.id, { ...ref, negated: /(^|\.)not(\.|\[|$)/.test(r.path) });
    }
  }
  for (const [story, source] of Object.entries(raw.ink ?? {})) {
    for (const m of source.matchAll(INK_SET))
      add(setters, m[1] ?? '', { collection: 'ink', id: story, path: 'set_flag' });
    for (const m of source.matchAll(INK_READ))
      add(readers, m[1] ?? '', { collection: 'ink', id: story, path: 'flag', negated: false });
  }

  const declared = asList((raw.registry.data as Obj | null)?.['flags'] ?? []).map((f) =>
    String(f['id']),
  );
  const findings: Finding[] = [];
  for (const flag of new Set([...declared, ...readers.keys(), ...setters.keys()])) {
    const s = setters.get(flag) ?? [];
    const r = readers.get(flag) ?? [];
    const plain = r.map(({ negated: _n, ...ref }) => ref);
    if (r.length > 0 && s.length === 0) {
      findings.push({
        code: 'flag-never-set',
        flag,
        message: `"${flag}" is read by ${String(r.length)} condition(s) but nothing sets it`,
        readers: plain,
      });
      for (const ref of r)
        if (!ref.negated && ref.collection !== 'ink')
          findings.push({
            code: 'maybe-unreachable',
            flag,
            entity: { collection: ref.collection, id: ref.id, path: ref.path },
            message: `${ref.collection}/${ref.id} requires "${flag}", which is never set`,
          });
    } else if (s.length > 0 && r.length === 0)
      findings.push({
        code: 'flag-never-read',
        flag,
        message: `"${flag}" is set but no condition reads it`,
        setters: s,
      });
    else if (s.length === 0 && r.length === 0)
      findings.push({ code: 'flag-unused', flag, message: `"${flag}" is declared but unused` });
  }

  // Graph: flag edges (setter → reader) and direct references between graph entities.
  const inGraph = (c: string) => (GRAPH as readonly string[]).includes(c);
  const nodes = entities
    .filter((e) => inGraph(e.collection))
    .map((e) => ({
      id: `${e.collection}/${String(e.body['id'])}`,
      collection: e.collection,
      label: text(e.body['nameKey'], String(e.body['id'])),
    }));
  const known = new Set(nodes.map((n) => n.id));
  const edges: Analysis['graph']['edges'] = [];
  for (const [flag, s] of setters)
    for (const from of s)
      for (const to of readers.get(flag) ?? []) {
        const a = `${from.collection}/${from.id}`;
        const b = `${to.collection}/${to.id}`;
        if (a !== b && known.has(a) && known.has(b))
          edges.push({ from: a, to: b, label: flag, kind: 'flag' });
      }
  for (const [from, refs] of refsOf) {
    if (!known.has(from)) continue;
    for (const r of refs) {
      const target = GRAPH_KINDS[r.kind];
      const to = target ? `${target}/${r.id}` : '';
      if (to && to !== from && known.has(to))
        edges.push({ from, to, label: r.path.split('.').pop() ?? r.kind, kind: 'ref' });
    }
  }

  const villagers = entities
    .filter((e) => e.collection === 'villagers')
    .map(({ body: v }) => ({
      id: String(v['id']),
      name: text(v['nameKey'], String(v['id'])),
      home: v['home'] ?? null,
      work: v['work'] ?? null,
      secrets: v['secrets'] ?? [],
      relationships: asList(v['relationships']).map((r) => ({
        villager: String(r['villager']),
        affinity: Number(r['affinity']),
      })),
    }));
  const mysteries = entities
    .filter((e) => e.collection === 'mysteries')
    .map(({ body: m }) => ({
      id: String(m['id']),
      name: text(m['nameKey'], String(m['id'])),
      suspects: m['suspects'] ?? [],
      clues: asList(m['clues']).map((c) => ({
        id: String(c['id']),
        name: text(c['nameKey'], String(c['id'])),
        sources: c['sources'] ?? [],
        supports: c['supports'] ?? [],
        refutes: c['refutes'] ?? [],
      })),
    }));

  return {
    issues: validatePack(raw).issues.map((i) => ({
      severity: i.severity,
      code: i.code,
      message: i.message,
      file: i.file,
    })),
    findings,
    graph: { nodes, edges },
    villagers,
    mysteries,
  };
}
