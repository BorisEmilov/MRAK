/** JSON Schema helpers for the generated forms (SchemaForm.tsx). */
import type { JsonSchema } from './api';

type S = JsonSchema;
export interface FormCtx {
  defs: Record<string, S>;
  ids: Record<string, string[]>;
  texts: Record<string, string>;
}

export function resolve(s: S, ctx: FormCtx): { schema: S; name: string | null } {
  const ref = s['$ref'];
  if (typeof ref === 'string') {
    const name = ref.split('/').pop() ?? '';
    return { schema: resolve(ctx.defs[name] ?? {}, ctx).schema, name };
  }
  return { schema: s, name: null };
}

export const branches = (s: S): S[] => ((s['anyOf'] ?? s['oneOf']) as S[] | undefined) ?? [];
/** The operator key of a union branch: its first required property. */
export const opOf = (b: S, ctx: FormCtx): string | null => {
  const r = resolve(b, ctx).schema;
  const req = r['required'] as string[] | undefined;
  return r['type'] === 'object' && req?.[0] ? req[0] : null;
};

export function makeDefault(s: S, ctx: FormCtx): unknown {
  const { schema } = resolve(s, ctx);
  if ('default' in schema) return structuredClone(schema['default']);
  const anyOf = branches(schema);
  if (anyOf[0]) return makeDefault(anyOf[0], ctx);
  if (Array.isArray(schema['enum'])) return (schema['enum'] as unknown[])[0];
  switch (schema['type']) {
    case 'object': {
      const props = (schema['properties'] ?? {}) as Record<string, S>;
      const req = (schema['required'] ?? []) as string[];
      return Object.fromEntries(req.map((k) => [k, makeDefault(props[k] ?? {}, ctx)]));
    }
    case 'array':
      return [];
    case 'integer':
    case 'number':
      return typeof schema['minimum'] === 'number' ? schema['minimum'] : 0;
    case 'boolean':
      return false;
    default:
      return '';
  }
}

export const refKind = (s: S): string | null =>
  /^Reference to an? ([a-z-]+)/.exec(
    typeof s['description'] === 'string' ? s['description'] : '',
  )?.[1] ?? null;
