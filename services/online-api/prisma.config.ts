import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Not required for `prisma generate`; required for migrations.
    url: process.env['DATABASE_URL'] ?? '',
    // CI migration review: `migrate diff --from-migrations` replays them into this empty database.
    ...(process.env['SHADOW_DATABASE_URL']
      ? { shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] }
      : {}),
  },
});
