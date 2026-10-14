import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { attachRealtime } from './realtime.js'
import type { RequestEvent } from './requests.js'
import { makeExtractor, parseChoice } from './quote/models.js'
import { LocalStorage } from './storage.js'

const config = loadConfig()
const db = createDb(config.DATABASE_URL)
const storage = new LocalStorage(config.STORAGE_DIR)

// Socket.IO needs the HTTP server, which exists only once the app is built: publish late
// The quote check runs when the chosen model's provider has a key
const choice = parseChoice(config.QUOTE_CHECK_MODEL)
const keys = {
  anthropic: config.ANTHROPIC_API_KEY,
  openai: config.OPENAI_API_KEY,
  gemini: config.GEMINI_API_KEY,
}
const quoteChecker = keys[choice.provider]
  ? { choice, extract: await makeExtractor(choice, keys[choice.provider]) }
  : null

let send: (event: RequestEvent) => void = () => {}
const app = buildApp({ config, db, storage, publish: (event) => send(event), quoteChecker })
app.log.info(
  quoteChecker
    ? `Quote check: ${choice.provider}/${choice.model}`
    : `Quote check off: no key for ${choice.provider}`,
)
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
