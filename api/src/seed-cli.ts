import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { seedDemo } from './seed.js'
import { LocalStorage } from './storage.js'

// `just seed`: replace the data with the demo personas and requests.
const config = loadConfig()
const db = createDb(config.DATABASE_URL)
const storage = new LocalStorage(config.STORAGE_DIR)
const users = await seedDemo(
  db,
  { financeThresholdCents: config.financeThresholdCents },
  storage,
  { appUrl: config.APP_URL },
)
console.log(`Seeded ${Object.keys(users).length} personas and their requests.`)
await db.$disconnect()
