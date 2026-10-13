import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb } from './db.js'

const config = loadConfig()
const db = createDb(config.DATABASE_URL)
const app = buildApp(config, db)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close()
    await db.$disconnect()
  })
}

await app.listen({ host: '0.0.0.0', port: config.PORT })
