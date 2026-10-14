import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SESSION_COOKIE } from '../src/app.js'
import type { EntraProfile, EntraSignIn } from '../src/entra.js'
import { setUp, tearDown, type TestContext } from './helpers.js'

/** Stands in for Microsoft: hands out codes for whoever `next` says is signing in. */
class FakeMicrosoft implements EntraSignIn {
  next: EntraProfile = { objectId: 't1:o1', name: 'Jordan Park', email: 'jordan@contoso.test' }
  lastAuth: { state: string; nonce: string; codeChallenge: string } | null = null
  redeemed: { code: string; nonce: string; codeVerifier: string }[] = []

  async authUrl(p: { redirectUri: string; state: string; nonce: string; codeChallenge: string }) {
    this.lastAuth = p
    return `https://login.example/authorize?state=${p.state}&redirect_uri=${encodeURIComponent(p.redirectUri)}`
  }

  async redeem(p: { code: string; nonce: string; codeVerifier: string }) {
    if (p.code !== 'good-code') throw new Error('invalid_grant')
    this.redeemed.push(p)
    return this.next
  }
}

let ctx: TestContext
const microsoft = new FakeMicrosoft()
beforeAll(async () => {
  ctx = await setUp({ entra: microsoft, env: { DEMO_MODE: 'true', APP_URL: 'https://app.test' } })
})
afterAll(async () => tearDown(ctx))

/** Leave for "Microsoft", returning the pending-sign-in cookie and the state sent there. */
async function start() {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/entra/start' })
  const pending = res.cookies.find((c) => c.name === 'fa_entra')!
  return { res, cookie: `fa_entra=${pending.value}`, state: microsoft.lastAuth!.state }
}

async function callback(query: string, cookie?: string) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/auth/entra/callback?${query}`,
    headers: cookie ? { cookie } : {},
  })
}

async function me(res: Awaited<ReturnType<typeof callback>>) {
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE && c.value)
  if (!session) return null
  const who = await ctx.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: `${SESSION_COOKIE}=${session.value}` },
  })
  return who.json()
}

describe('signing in with Microsoft', () => {
  it('sends people to Microsoft with a fresh state, nonce and PKCE challenge', async () => {
    const { res } = await start()
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('https://login.example/authorize')
    expect(res.headers.location).toContain(encodeURIComponent('https://app.test/api/auth/entra/callback'))
    const first = microsoft.lastAuth!
    await start()
    expect(microsoft.lastAuth!.state).not.toBe(first.state)
    expect(microsoft.lastAuth!.nonce).not.toBe(first.nonce)
    expect(first.codeChallenge).toMatch(/^[\w-]{43}$/) // a SHA-256, base64url
  })

  it('signs a visitor in as a requester reporting to Mo on the demo', async () => {
    const { cookie, state } = await start()
    const res = await callback(`code=good-code&state=${state}`, cookie)
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/')
    const user = await me(res)
    expect(user).toMatchObject({
      name: 'Jordan Park',
      email: 'jordan@contoso.test',
      roles: ['requester'],
      manager: { name: 'Mo Patel' },
    })
    // The verifier that matches the challenge, and the nonce, went with the code
    const sent = microsoft.redeemed.at(-1)!
    expect(sent.nonce).toBe(microsoft.lastAuth!.nonce)
    expect(createHash('sha256').update(sent.codeVerifier).digest('base64url')).toBe(
      microsoft.lastAuth!.codeChallenge,
    )
  })

  it('finds the same account next time, and keeps visitors out of the persona list', async () => {
    const { cookie, state } = await start()
    microsoft.next = { ...microsoft.next, name: 'Jordan P. Park' }
    const user = await me(await callback(`code=good-code&state=${state}`, cookie))
    expect(user.name).toBe('Jordan P. Park')
    expect(await ctx.db.user.count({ where: { email: 'jordan@contoso.test' } })).toBe(1)
    const personas = (await ctx.as(null).get('/api/auth/personas')).body
    expect(personas.map((p: { name: string }) => p.name)).not.toContain('Jordan P. Park')
  })

  it('refuses a callback whose state does not match, or that has no pending sign-in', async () => {
    const { cookie } = await start()
    const forged = await callback('code=good-code&state=someone-elses', cookie)
    expect(forged.headers.location).toBe('/?signin=expired')
    expect(await me(forged)).toBeNull()
    const { state } = await start()
    expect((await callback(`code=good-code&state=${state}`)).headers.location).toBe('/?signin=expired')
  })

  it('refuses a tampered pending-sign-in cookie', async () => {
    const { state } = await start()
    const forged = `fa_entra=${encodeURIComponent(JSON.stringify({ state, nonce: 'n', verifier: 'v' }))}.bad`
    expect((await callback(`code=good-code&state=${state}`, forged)).headers.location).toBe('/?signin=expired')
  })

  it('reports a cancelled or failed sign-in without signing anyone in', async () => {
    const a = await start()
    const cancelled = await callback(`error=access_denied&state=${a.state}`, a.cookie)
    expect(cancelled.headers.location).toBe('/?signin=cancelled')
    const b = await start()
    const failed = await callback(`code=bad-code&state=${b.state}`, b.cookie)
    expect(failed.headers.location).toBe('/?signin=failed')
    expect(await me(failed)).toBeNull()
  })

  it('does not take over an existing account with the same email', async () => {
    microsoft.next = { objectId: 't2:o9', name: 'Not Rita', email: 'rita@example.com' }
    const { cookie, state } = await start()
    const res = await callback(`code=good-code&state=${state}`, cookie)
    expect(res.headers.location).toBe('/?signin=taken')
    expect(await me(res)).toBeNull()
  })

  it('reports itself in health', async () => {
    expect((await ctx.as(null).get('/api/health')).body.entra).toBe(true)
  })
})
