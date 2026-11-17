import type { z } from 'zod';
import {
  COLLECTION_NAMES,
  COLLECTIONS,
  LocaleFile,
  type CollectionName,
  type ContentPack,
  type RawPack,
  type SourceMap,
} from '../pack';
import { LOC_KEY_PATTERN } from '../primitives';
import { Registry } from '../registry';
import type { IssueList } from './issues';

function zodPath(path: readonly PropertyKey[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join('');
}

function reportZod(issues: IssueList, error: z.ZodError, file: string, entity?: string): void {
  for (const zi of error.issues) {
    issues.error('schema', zi.message, {
      file,
      ...(entity ? { entity } : {}),
      path: zodPath(zi.path),
    });
  }
}

/**
 * Parses every file of a raw pack with its schema. A file may hold one entity or an array of
 * entities. Returns the parsed pack (only valid entities) and where each entity came from.
 */
export function parsePack(
  raw: RawPack,
  issues: IssueList,
): { pack: ContentPack; sources: SourceMap } {
  const registryResult = Registry.safeParse(raw.registry.data);
  if (!registryResult.success) reportZod(issues, registryResult.error, raw.registry.file);
  const localeResult = LocaleFile.safeParse(raw.locales.en.data);
  if (!localeResult.success) reportZod(issues, localeResult.error, raw.locales.en.file);

  const sources: SourceMap = {};
  const collections = {} as Record<CollectionName, unknown[]>;

  for (const name of COLLECTION_NAMES) {
    const { schema } = COLLECTIONS[name];
    const parsed: unknown[] = [];
    const sourceOf: Record<string, string> = {};
    for (const entry of raw.collections[name] ?? []) {
      const values: unknown[] = Array.isArray(entry.data) ? entry.data : [entry.data];
      values.forEach((value, index) => {
        const result = schema.safeParse(value);
        const rawId =
          typeof value === 'object' && value !== null && 'id' in value
            ? String(value.id)
            : `#${index}`;
        if (!result.success) {
          reportZod(issues, result.error, entry.file, `${name}/${rawId}`);
          return;
        }
        const id = (result.data as { id: string }).id;
        if (id in sourceOf) {
          issues.error('duplicate-id', `duplicate id "${id}" (also in ${sourceOf[id] ?? '?'})`, {
            file: entry.file,
            entity: `${name}/${id}`,
          });
          return;
        }
        sourceOf[id] = entry.file;
        parsed.push(result.data);
      });
    }
    collections[name] = parsed;
    sources[name] = sourceOf;
  }

  // Keep the valid locale entries even if some keys are invalid, so one bad key does not turn
  // every reference into a "missing key" error.
  const rawLocale = raw.locales.en.data;
  const localeEntries =
    typeof rawLocale === 'object' && rawLocale !== null
      ? Object.fromEntries(
          Object.entries(rawLocale).filter(
            ([key, text]) =>
              LOC_KEY_PATTERN.test(key) && typeof text === 'string' && text.length > 0,
          ),
        )
      : {};

  const pack = {
    registry: registryResult.success
      ? registryResult.data
      : { flags: [], stats: [], rules: [], contexts: [] },
    locales: { en: localeResult.success ? localeResult.data : localeEntries },
    ...collections,
  } as ContentPack;
  return { pack, sources };
}
