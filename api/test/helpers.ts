import type { FastifyInstance } from 'fastify'
import { inject } from 'vitest'
import { buildApp, SESSION_COOKIE } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createDb, type Db } from '../src/db.js'
import type { User } from '../src/generated/prisma/client.js'
import type { RequestEvent } from '../src/requests.js'
import { seedDemo } from '../src/seed.js'
import { LocalStorage } from '../src/storage.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TestContext {
  app: FastifyInstance
  db: Db
  users: Record<string, User>
  events: RequestEvent[]
  /** The session cookie for a persona, for raw requests and Socket.IO. */
  cookieFor: (who: string) => Promise<string>
  /** Make a request as one of the personas (by key, e.g. 'rita'), or signed out. */
  as: (who: string | null) => {
    get: (url: string) => Promise<Response>
    post: (url: string, body?: unknown) => Promise<Response>
    patch: (url: string, body: unknown) => Promise<Response>
  }
}

interface Response {
  status: number
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any -- test responses
}

export async function setUp(): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('testDatabaseUrl'),
    APPROVAL_FINANCE_THRESHOLD: '1000',
  })
  const db = createDb(config.DATABASE_URL)
  const storage = new LocalStorage(mkdtempSync(join(tmpdir(), 'flowapprove-test-')))
  const users = await seedDemo(db, { financeThresholdCents: config.financeThresholdCents }, storage)
  const events: RequestEvent[] = []
  const app = buildApp({ config, db, storage, publish: (e) => events.push(e) })
  await app.ready()

  const cookies: Record<string, string> = {}
  async function cookieFor(who: string): Promise<string> {
    if (!cookies[who]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/demo',
        payload: { userId: users[who]!.id },
      })
      const set = res.cookies.find((c) => c.name === SESSION_COOKIE)
      if (!set) throw new Error(`no session for ${who}`)
      cookies[who] = `${SESSION_COOKIE}=${set.value}`
    }
    return cookies[who]!
  }

  const as: TestContext['as'] = (who) => {
    const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
      const headers = who ? { cookie: await cookieFor(who) } : {}
      const res = await app.inject({
        method,
        url,
        headers,
        ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
      })
      return { status: res.statusCode, body: res.body ? res.json() : null }
    }
    return {
      get: (url) => call('GET', url),
      post: (url, body) => call('POST', url, body ?? {}),
      patch: (url, body) => call('PATCH', url, body),
    }
  }

  return { app, db, users, events, as, cookieFor }
}

export async function tearDown(ctx: TestContext) {
  await ctx.app.close()
  await ctx.db.$disconnect()
}
