import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setUp, tearDown, type TestContext } from './helpers.js'

let ctx: TestContext

beforeAll(async () => {
  ctx = await setUp()
})
afterAll(async () => tearDown(ctx))
beforeEach(() => {
  ctx.events.length = 0
})

const newRequest = (amount: number, title = 'Laptop dock') => ({
  title,
  vendor: 'Contoso Supplies',
  category: 'Hardware',
  description: 'For the new hire.',
  amount,
})

async function create(who: string, amount: number) {
  const res = await ctx.as(who).post('/api/requests', newRequest(amount))
  expect(res.status).toBe(201)
  return res.body.id as string
}

const doAct = (who: string, id: string, action: string, comment = '') =>
  ctx.as(who).post(`/api/requests/${id}/actions`, { action, comment })

describe('signing in', () => {
  it('lists the demo personas and signs in as one', async () => {
    const personas = await ctx.as(null).get('/api/auth/personas')
    expect(personas.body.map((p: { name: string }) => p.name)).toContain('Rita Chen')
    const me = await ctx.as('rita').get('/api/me')
    expect(me.body).toMatchObject({ name: 'Rita Chen', manager: { name: 'Mo Patel' } })
  })

  it('refuses requests without a session', async () => {
    expect((await ctx.as(null).get('/api/me')).status).toBe(401)
    expect((await ctx.as(null).get('/api/requests')).status).toBe(401)
  })
})

describe('seeded inboxes', () => {
  const titles = async (who: string, view: string) =>
    (await ctx.as(who).get(`/api/requests?view=${view}`)).body.map((r: { title: string }) => r.title)

  it('shows each approver what waits on them, and nothing of their own', async () => {
    expect(await titles('mo', 'inbox')).toEqual(['Monitors for the design review room'])
    expect(await titles('fay', 'inbox')).toEqual(['Design tool seats, annual plan'])
    expect(await titles('dana', 'inbox')).toEqual(['Team offsite catering'])
    expect(await titles('rita', 'inbox')).toEqual([])
  })

  it('limits the all-requests view to finance (no drafts) and admins', async () => {
    expect((await ctx.as('rita').get('/api/requests?view=all')).status).toBe(403)
    expect(await titles('fay', 'all')).not.toContain('Mechanical keyboard')
    expect(await titles('ada', 'all')).toContain('Mechanical keyboard')
  })
})

describe('the approval path', () => {
  it('runs a request through manager and finance, recording each step', async () => {
    const id = await create('rita', 1500)
    expect((await doAct('rita', id, 'submit')).body.status).toBe('pending_manager')
    expect((await doAct('mo', id, 'approve')).body.status).toBe('pending_finance')
    expect((await doAct('fay', id, 'approve', 'OK')).body.status).toBe('approved')

    const detail = (await ctx.as('rita').get(`/api/requests/${id}`)).body
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual([
      'created',
      'submit',
      'approve',
      'approve',
    ])
    expect(detail.decisions.map((d: { step: string; actor: { name: string } }) => [d.step, d.actor.name]))
      .toEqual([
        ['manager', 'Mo Patel'],
        ['finance', 'Fay Nguyen'],
      ])
    expect(detail.closedAt).not.toBeNull()
    expect(detail.actions).toEqual([])
  })

  it('tells the people involved about every change', async () => {
    const id = await create('rita', 200)
    await doAct('rita', id, 'submit')
    const submitted = ctx.events.find((e) => e.action === 'submit')!
    expect(submitted.audience.userIds.sort()).toEqual([ctx.users.mo!.id, ctx.users.rita!.id].sort())
  })

  it('offers each person the right buttons', async () => {
    const id = await create('rita', 200)
    await doAct('rita', id, 'submit')
    const forMo = (await ctx.as('mo').get(`/api/requests/${id}`)).body
    expect(forMo.actions).toEqual(['approve', 'reject', 'request_changes'])
    expect(forMo.waitingOn).toBe('manager')
    const forRita = (await ctx.as('rita').get(`/api/requests/${id}`)).body
    expect(forRita.actions).toEqual(['cancel'])
  })

  it('lets the requester edit a request sent back, then resubmit', async () => {
    const id = await create('sam', 300)
    await doAct('sam', id, 'submit')
    await doAct('mo', id, 'request_changes', 'Which model?')
    const edited = await ctx.as('sam').patch(`/api/requests/${id}`, { title: 'Laptop dock, model X2' })
    expect(edited.status).toBe(200)
    expect((await doAct('sam', id, 'submit')).body.status).toBe('pending_manager')
    const history = (await ctx.as('sam').get(`/api/requests/${id}`)).body.history
    const edit = history.find((h: { action: string }) => h.action === 'edited')
    expect(edit.details.changed.title).toEqual({ from: 'Laptop dock', to: 'Laptop dock, model X2' })
  })
})

describe('permissions', () => {
  it('stops requesters approving, and hides requests from people outside the chain', async () => {
    const id = await create('rita', 200)
    await doAct('rita', id, 'submit')
    expect((await doAct('rita', id, 'approve')).status).toBe(403)
    expect((await ctx.as('sam').get(`/api/requests/${id}`)).status).toBe(404)
    expect((await doAct('sam', id, 'approve')).status).toBe(404)
  })

  it('needs a comment to reject or send back', async () => {
    const id = await create('rita', 200)
    await doAct('rita', id, 'submit')
    const res = await doAct('mo', id, 'reject')
    expect(res.status).toBe(400)
    expect(res.body.detail).toMatch(/comment/)
  })

  it('keeps drafts private, and stops edits once submitted', async () => {
    const id = await create('rita', 200)
    expect((await ctx.as('mo').get(`/api/requests/${id}`)).status).toBe(404)
    expect((await ctx.as('mo').patch(`/api/requests/${id}`, { title: 'Mine now' })).status).toBe(404)
    await doAct('rita', id, 'submit')
    expect((await ctx.as('mo').get(`/api/requests/${id}`)).status).toBe(200)
    expect((await ctx.as('mo').patch(`/api/requests/${id}`, { title: 'Mine now' })).status).toBe(403)
    expect((await ctx.as('rita').patch(`/api/requests/${id}`, { title: 'Changed' })).status).toBe(409)
  })

  it('validates input', async () => {
    const res = await ctx.as('rita').post('/api/requests', { ...newRequest(-5) })
    expect(res.status).toBe(400)
    expect(res.body.detail).toMatch(/^amount/)
  })
})

describe('consistency', () => {
  it('handles two approvals at the same moment one after the other', async () => {
    const id = await create('rita', 200)
    await doAct('rita', id, 'submit')
    const results = await Promise.all([doAct('mo', id, 'approve'), doAct('mo', id, 'approve')])
    expect(results.map((r) => r.status).sort()).toEqual([200, 403])
    const detail = (await ctx.as('rita').get(`/api/requests/${id}`)).body
    expect(detail.decisions).toHaveLength(1)
  })

  it('refuses to change or delete audit history', async () => {
    await expect(ctx.db.auditEvent.updateMany({ data: { action: 'tampered' } })).rejects.toThrow(
      /append-only/,
    )
    await expect(ctx.db.auditEvent.deleteMany()).rejects.toThrow(/append-only/)
  })
})
