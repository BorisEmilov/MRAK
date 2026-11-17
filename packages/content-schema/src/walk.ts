import type { z } from 'zod';
import { refRegistry, type RefKind } from './primitives';

export interface FoundRef {
  kind: RefKind;
  id: string;
  /** JSON path inside the entity, e.g. "nodes[3].talent". */
  path: string;
}

interface Def {
  type: string;
  innerType?: z.ZodType;
  element?: z.ZodType;
  valueType?: z.ZodType;
  options?: z.ZodType[];
  shape?: Record<string, z.ZodType>;
  in?: z.ZodType;
  getter?: () => z.ZodType;
}

function defOf(schema: z.ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walks an already-parsed value alongside its schema and reports every reference field
 * (schemas created with `ref(kind)`). For unions, the first option that accepts the value is used.
 */
export function collectRefs(schema: z.ZodType, value: unknown, path = ''): FoundRef[] {
  const out: FoundRef[] = [];
  visit(schema, value, path, out);
  return out;
}

function visit(schema: z.ZodType, value: unknown, path: string, out: FoundRef[]): void {
  if (value === undefined || value === null) return;
  const meta = refRegistry.get(schema);
  if (meta && typeof value === 'string') {
    out.push({ kind: meta.refKind, id: value, path });
    return;
  }
  const def = defOf(schema);
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      if (def.innerType) visit(def.innerType, value, path, out);
      return;
    case 'pipe':
      if (def.in) visit(def.in, value, path, out);
      return;
    case 'lazy':
      if (def.getter) visit(def.getter(), value, path, out);
      return;
    case 'object':
      if (isRecord(value) && def.shape) {
        for (const [key, child] of Object.entries(value)) {
          const childSchema = def.shape[key];
          if (childSchema) visit(childSchema, child, path ? `${path}.${key}` : key, out);
        }
      }
      return;
    case 'array':
      if (Array.isArray(value) && def.element) {
        const element = def.element;
        value.forEach((item, i) => {
          visit(element, item, `${path}[${i}]`, out);
        });
      }
      return;
    case 'record':
      if (isRecord(value) && def.valueType) {
        const valueType = def.valueType;
        for (const [key, child] of Object.entries(value))
          visit(valueType, child, `${path}.${key}`, out);
      }
      return;
    case 'union': {
      const match = def.options?.find((option) => option.safeParse(value).success);
      if (match) visit(match, value, path, out);
      return;
    }
    default:
      return;
  }
}

/** Generic deep traversal of plain JSON, calling `fn` for every object node. */
export function forEachObject(
  value: unknown,
  fn: (node: Record<string, unknown>, path: string) => void,
  path = '',
): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      forEachObject(item, fn, `${path}[${i}]`);
    });
  } else if (isRecord(value)) {
    fn(value, path);
    for (const [key, child] of Object.entries(value)) {
      forEachObject(child, fn, path ? `${path}.${key}` : key);
    }
  }
}
