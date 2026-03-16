import { defineConfig } from 'prisma/config'

// DATABASE_URL is required at runtime for migrations and queries.
// A fallback placeholder allows `prisma generate` (codegen only, no DB connection)
// to run during CI `pnpm install` postinstall without a live database.
export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://ci:ci@localhost:5432/ci',
  },
})