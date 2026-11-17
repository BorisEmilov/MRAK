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
      },
    },
  },
});
