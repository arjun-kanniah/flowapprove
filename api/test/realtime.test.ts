import type { AddressInfo } from 'node:net'
import { io as connect, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attachRealtime } from '../src/realtime.js'
import { setUp, tearDown, type TestContext } from './helpers.js'

let ctx: TestContext
let url: string
let realtime: ReturnType<typeof attachRealtime>
const sockets: Socket[] = []

beforeAll(async () => {
  ctx = await setUp()
  realtime = attachRealtime(ctx.app, ctx.db)
  await ctx.app.listen({ port: 0, host: '127.0.0.1' })
  url = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`
})
afterAll(async () => {
  sockets.forEach((s) => s.close())
  await realtime.close()
  await tearDown(ctx)
})

async function listen(who: string | null) {
  const headers: Record<string, string> = who ? { cookie: await ctx.cookieFor(who) } : {}
  const socket = connect(url, { transports: ['websocket'], extraHeaders: headers, reconnection: false })
  sockets.push(socket)
  const received: unknown[] = []
  socket.on('request.changed', (msg) => received.push(msg))
  const connected = await new Promise<boolean>((resolve) => {
    socket.on('connect', () => resolve(true))
    socket.on('connect_error', () => resolve(false))
  })
  return { connected, received }
}

describe('live updates', () => {
  it('refuses connections without a session', async () => {
    expect((await listen(null)).connected).toBe(false)
  })

  it('tells the manager about a submitted request, and not people outside it', async () => {
    const mo = await listen('mo')
    const sam = await listen('sam')
    const created = await ctx.as('rita').post('/api/requests', {
      title: 'Live test',
      vendor: 'Contoso',
      category: 'Hardware',
      amount: 120,
    })
    for (const event of ctx.events) realtime.publish(event)
    ctx.events.length = 0
    await ctx.as('rita').post(`/api/requests/${created.body.id}/actions`, { action: 'submit' })
    for (const event of ctx.events) realtime.publish(event)

    await expect.poll(() => mo.received).toContainEqual(
      expect.objectContaining({ requestId: created.body.id, status: 'pending_manager' }),
    )
    expect(sam.received).toEqual([])
  })
})
