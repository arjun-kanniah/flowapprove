import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb } from './db.js'

const config = loadConfig({ ...process.env, NODE_ENV: 'test' })
const db = createDb(config.DATABASE_URL)
const app = buildApp(config, db)

afterAll(async () => {
  await app.close()
  await db.$disconnect()
})

describe('GET /api/health', () => {
  it('reports ok once the database answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', demo: false })
  })
})

describe('config', () => {
  it('turns the finance threshold into cents', () => {
    expect(loadConfig({ APPROVAL_FINANCE_THRESHOLD: '1500.50' }).financeThresholdCents).toBe(
      150050,
    )
  })
})
