import { defineConfig } from 'prisma/config'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required but not set')
}

export default defineConfig({
  datasource: {
    url: databaseUrl,
  },
})
