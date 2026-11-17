/** Test helpers: load the real content pack and mutate deep copies of it. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CollectionName, RawPack } from './pack';
import { loadRawPack } from './node/fs';
import { IssueList, validatePack, type Issue } from './validate';

export const CONTENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../content');

const pristine = loadRawPack(CONTENT_ROOT, new IssueList());

/** A fresh deep copy of the real pack. */
export function realPack(): RawPack {
  return structuredClone(pristine);
}

type Json = Record<string, unknown>;

/** Finds an entity by collection and id in a raw pack and lets `fn` mutate it. */
export function mutate(
  raw: RawPack,
  collection: CollectionName,
  id: string,
  fn: (entity: Json) => void,
): RawPack {
  for (const entry of raw.collections[collection] ?? []) {
    const list = (Array.isArray(entry.data) ? entry.data : [entry.data]) as Json[];
    const found = list.find((e) => e['id'] === id);
    if (found) {
      fn(found);
      return raw;
    }
  }
  throw new Error(`test setup: ${collection}/${id} not found`);
}

export function errorsOf(raw: RawPack): Issue[] {
  return validatePack(raw).issues.filter((i) => i.severity === 'error');
}

export function codes(raw: RawPack): string[] {
  return errorsOf(raw).map((i) => i.code);
}
