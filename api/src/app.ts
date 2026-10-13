import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import type { Db } from './db.js'

export const VERSION = '0.1.0'

/** The HTTP app, built separately from main.ts so tests can call it without a network port. */
export function buildApp(config: Config, db: Db): FastifyInstance {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' })

  app.get('/api/health', async () => {
    await db.$queryRaw`SELECT 1`
    return { status: 'ok', version: VERSION, demo: config.DEMO_MODE }
  })

  return app
}
