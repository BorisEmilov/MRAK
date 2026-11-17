/**
 * Ink sources on disk and their compilation (docs/systems/dialogue.md → Implementation). Used by
 * the content CLI (CI) — the game compiles the same sources at build time with its Vite plugin.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Compiler, CompilerOptions } from 'inkjs/full';
import type { IssueList } from '../validate/issues';

export const INK_DIR = 'ink';

/** Story id → Ink source, from `<root>/ink/*.ink`. */
export function loadInk(root: string): Record<string, string> {
  const dir = join(root, INK_DIR);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.ink'));
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const f of files.sort()) out[basename(f, '.ink')] = readFileSync(join(dir, f), 'utf8');
  return out;
}

/** Compiles one story; returns its JSON or the compiler's errors. */
export function compileInk(source: string): { json: string | null; errors: string[] } {
  const errors: string[] = [];
  const options = new CompilerOptions(null, [], false, (message: string, type: number) => {
    // ErrorType: 0 author, 1 warning, 2 error.
    if (type === 2) errors.push(message);
  });
  try {
    const story = new Compiler(source, options).Compile();
    return { json: errors.length ? null : (story.ToJson() ?? null), errors };
  } catch (err) {
    if (errors.length === 0) errors.push(err instanceof Error ? err.message : String(err));
    return { json: null, errors };
  }
}

/** Compiles every story; reports compile errors. */
export function compileAll(stories: Readonly<Record<string, string>>, issues: IssueList): void {
  for (const [id, source] of Object.entries(stories))
    for (const message of compileInk(source).errors)
      issues.error('ink-compile', message, { file: `ink/${id}.ink` });
}
