import { z } from 'zod';
import { Condition, Effect, Modifier } from './lang';
import { ContentManifest } from './manifest';
import { COLLECTION_NAMES, COLLECTIONS, LocaleFile } from './pack';
import { Registry } from './registry';

/**
 * JSON Schemas (draft 2020-12) for the editor and the API, generated from the Zod schemas with
 * Zod 4's native `z.toJSONSchema`. Cross-field refinements (e.g. "exactly one comparator")
 * cannot be expressed in JSON Schema and are enforced only by `pnpm content:validate`.
 */
export function buildJsonSchemas(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const add = (name: string, schema: z.ZodType): void => {
    out[name] = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
    });
  };
  for (const name of COLLECTION_NAMES) {
    const { schema } = COLLECTIONS[name];
    // A data file may hold one entity or an array of them.
    add(name, z.union([schema, z.array(schema)]));
  }
  add('condition', Condition);
  add('effect', Effect);
  add('modifier', Modifier);
  add('flags', Registry);
  add('locale', LocaleFile);
  add('manifest', ContentManifest);
  return out;
}
