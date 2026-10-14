import { afterAll, beforeAll, expect, it } from 'vitest'
import { setUp, tearDown, type TestContext } from './helpers.js'

let ctx: TestContext
beforeAll(async () => {
  ctx = await setUp() // no model configured
})
afterAll(async () => tearDown(ctx))

it('reports the check as unavailable when no model is set up', async () => {
  const all = (await ctx.as('ada').get('/api/requests?view=all')).body
  const id = all.find((r: { title: string }) => r.title.startsWith('Monitors')).id
  expect((await ctx.as('rita').get(`/api/requests/${id}`)).body.quoteCheckAvailable).toBe(false)
  expect((await ctx.as('rita').post(`/api/requests/${id}/quote-check`)).status).toBe(503)
})
