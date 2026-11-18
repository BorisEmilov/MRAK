/**
 * Vite plugin: compiles `.ink` stories to Ink JSON at build time (dev, build and tests), so the
 * game ships compiled stories and never the compiler (docs/systems/dialogue.md → Implementation).
 */
import { Compiler, CompilerOptions } from 'inkjs/full';
import type { Plugin } from 'vite';

export function inkPlugin(): Plugin {
  return {
    name: 'mrak-ink',
    transform(source, id) {
      if (!id.endsWith('.ink')) return null;
      const errors: string[] = [];
      const options = new CompilerOptions(null, [], false, (message: string, type: number) => {
        if (type === 2) errors.push(message);
      });
      let json: string | null = null;
      try {
        json = new Compiler(source, options).Compile().ToJson() ?? null;
      } catch {
        // errors were collected by the handler
      }
      if (!json || errors.length > 0)
        this.error(`Ink compile failed for ${id}:\n${errors.join('\n')}`);
      return { code: `export default ${JSON.stringify(json)};`, map: null };
    },
  };
}
