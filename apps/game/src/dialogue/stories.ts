/** Ink stories bundled with the game, compiled at build time (build/ink-plugin.ts), by id. */
const files = import.meta.glob<string>('../../../../packages/content/ink/*.ink', {
  eager: true,
  import: 'default',
});

export const STORIES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, json]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.ink'.length),
    json,
  ]),
);
