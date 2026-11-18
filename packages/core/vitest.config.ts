import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/index.ts'],
      reporter: ['text-summary'],
      thresholds: {
        lines: 90,
        branches: 80,
        // The condition & effect language must stay thoroughly tested.
        'src/conditions.ts': { lines: 95, branches: 90 },
        'src/effects.ts': { lines: 95, branches: 85 },
        // Critical systems (docs/systems/testing.md → Coverage): raise, never lower.
        'src/state/world-state.ts': { lines: 98, branches: 95 },
        'src/occult/pacts.ts': { lines: 90, branches: 65 },
        'src/occult/possession.ts': { lines: 98, branches: 80 },
        'src/chronicle/lineage.ts': { lines: 95, branches: 75 },
        'src/chronicle/achievements.ts': { lines: 98, branches: 95 },
        'src/save/*.ts': { lines: 94, branches: 60 },
        'src/bot/bot.ts': { lines: 85, branches: 75 },
      },
    },
  },
});
