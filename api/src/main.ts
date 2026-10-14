import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { createEntraSignIn } from './entra.js'
import { attachRealtime } from './realtime.js'
import type { RequestEvent } from './requests.js'
import { AcsMailer, LogMailer } from './mailer.js'
import { startOutboxWorker } from './outbox.js'
import { makeExtractor, parseChoice } from './quote/models.js'
import { createStorage } from './storage.js'

const config = loadConfig()
const db = createDb(config.DATABASE_URL)
const storage = createStorage(config)

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
const entra = createEntraSignIn(config)
const app = buildApp({ config, db, storage, publish: (event) => send(event), quoteChecker, entra })
app.log.info(
  quoteChecker
    ? `Quote check: ${choice.provider}/${choice.model}`
    : `Quote check off: no key for ${choice.provider}`,
)
await app.ready()
const realtime = attachRealtime(app, db)
send = realtime.publish

// Deliver queued emails in the background
const mailer =
  config.EMAIL_DELIVERY === 'acs'
    ? new AcsMailer(config.ACS_ENDPOINT, config.EMAIL_FROM)
    : new LogMailer((line) => app.log.info(line))
const stopOutbox = startOutboxWorker(db, mailer, (error) => app.log.error(error, 'email delivery failed'))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopOutbox()
    await realtime.close()
    await app.close()
    await db.$disconnect()
  })
}

await app.listen({ host: '0.0.0.0', port: config.PORT })
