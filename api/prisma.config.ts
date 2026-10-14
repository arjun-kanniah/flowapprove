import { defineConfig } from 'prisma/config'

// DATABASE_URL comes from the environment (`just` loads the repo's .env). Generating the client
// doesn't need a database, so an image build can run without one; migrate does.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
