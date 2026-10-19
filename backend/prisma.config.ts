import { defineConfig } from 'prisma/config';

// Prisma CLI does not read backend/.env by itself. Without this, `prisma migrate` silently fell
// back to the built-in default URL below and failed against the Docker database.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file: rely on variables already present in the environment
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'mysql://knot:knot-dev-password@localhost:3306/knot' },
});
