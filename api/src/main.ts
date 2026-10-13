import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { attachRealtime } from './realtime.js'
import type { RequestEvent } from './requests.js'
import { LocalStorage } from './storage.js'

const config = loadConfig()
const db = createDb(config.DATABASE_URL)
const storage = new LocalStorage(config.STORAGE_DIR)

// Socket.IO needs the HTTP server, which exists only once the app is built: publish late
let send: (event: RequestEvent) => void = () => {}
const app = buildApp({ config, db, storage, publish: (event) => send(event) })
await app.ready()
const realtime = attachRealtime(app, db)
send = realtime.publish

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await realtime.close()
    await app.close()
    await db.$disconnect()
  })
}

await app.listen({ host: '0.0.0.0', port: config.PORT })
