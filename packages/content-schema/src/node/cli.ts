/**
 * Content CLI.
 *   validate [root]          validate the pack (schemas, cross refs, trees, mysteries, manifest)
 *   manifest [root]          (re)write manifest.json with file hashes
 *   json-schema [outDir]     export JSON Schemas for the editor and the API
 * `root` defaults to packages/content.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJsonSchemas } from '../json-schema';
import { ContentManifest } from '../manifest';
import { formatIssue, IssueList, validatePack } from '../validate';
import { buildManifest, checkManifest, CONTENT_LAYOUT, loadRawPack } from './fs';
import { compileAll } from './ink';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(here, '../../../content');
const DEFAULT_SCHEMA_OUT = resolve(here, '../../json-schema');

function validate(root: string): number {
  const loadIssues = new IssueList();
  const raw = loadRawPack(root, loadIssues);
  const result = validatePack(raw);
  compileAll(raw.ink ?? {}, loadIssues);
  checkManifest(root, loadIssues);
  const all = [...loadIssues.items, ...result.issues];
  for (const issue of all) console.log(formatIssue(issue));
  const errors = all.filter((i) => i.severity === 'error').length;
  const counts = Object.entries(result.pack)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}: ${String((v as unknown[]).length)}`)
    .join(', ');
  console.log(`\n${counts}`);
  console.log(errors === 0 ? '✔ content pack is valid' : `✘ ${String(errors)} error(s)`);
  return errors === 0 ? 0 : 1;
}

function manifest(root: string): number {
  let meta = { packId: 'mrak-base', version: '0.1.0' };
  try {
    const existing = ContentManifest.parse(
      JSON.parse(readFileSync(join(root, CONTENT_LAYOUT.manifest), 'utf8')),
    );
    meta = { packId: existing.packId, version: existing.version };
  } catch {
    // first manifest
  }
  const m = buildManifest(root, meta);
  writeFileSync(join(root, CONTENT_LAYOUT.manifest), `${JSON.stringify(m, null, 2)}\n`);
  console.log(`✔ manifest written: ${String(m.files.length)} files, hash ${m.hash.slice(0, 12)}…`);
  return 0;
}

function jsonSchema(outDir: string): number {
  mkdirSync(outDir, { recursive: true });
  const schemas = buildJsonSchemas();
  for (const [name, schema] of Object.entries(schemas)) {
    writeFileSync(join(outDir, `${name}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`);
  }
  console.log(`✔ ${String(Object.keys(schemas).length)} JSON Schemas written to ${outDir}`);
  return 0;
}

const [command, arg] = process.argv.slice(2);
const code =
  command === 'validate'
    ? validate(resolve(arg ?? DEFAULT_ROOT))
    : command === 'manifest'
      ? manifest(resolve(arg ?? DEFAULT_ROOT))
      : command === 'json-schema'
        ? jsonSchema(resolve(arg ?? DEFAULT_SCHEMA_OUT))
        : (console.error('usage: cli <validate|manifest|json-schema> [path]'), 2);
process.exitCode = code;
