import { defineConfig, env } from 'prisma/config'

// DATABASE_URL comes from the environment: `just` loads the repo's .env.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
})
