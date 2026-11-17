import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Account service gate (≥ 90 %). The Prisma repository needs Postgres: covered by the
      // integration suite against a database, not by unit tests.
      include: ['src/auth/**/*.ts'],
      exclude: ['src/auth/**/*.test.ts', 'src/auth/prisma-repository.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
