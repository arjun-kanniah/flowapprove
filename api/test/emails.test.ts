import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Mailer } from '../src/mailer.js'
import { backoffMs, deliverPending, MAX_ATTEMPTS } from '../src/outbox.js'
import { setUp, tearDown, type TestContext } from './helpers.js'

let ctx: TestContext
beforeAll(async () => {
  ctx = await setUp()
})
afterAll(async () => tearDown(ctx))

/** Emails to a persona about a request, as (kind, subject) pairs. */
async function mailFor(who: string, requestId?: string) {
  const rows = await ctx.db.emailMessage.findMany({
    where: { toUserId: ctx.users[who]!.id, ...(requestId && { requestId }) },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((r) => [r.kind, r.subject])
}

async function newRequest(who: string, amount: number) {
  const res = await ctx.as(who).post('/api/requests', {
    title: `Email test ${amount}`,
    vendor: 'Contoso',
    category: 'Hardware',
    amount,
  })
  return res.body.id as string
}

const doAct = (who: string, id: string, action: string, comment = '') =>
  ctx.as(who).post(`/api/requests/${id}/actions`, { action, comment })

describe('who is told what', () => {
  it('tells the manager, then finance, then the requester, as a request moves on', async () => {
    const id = await newRequest('rita', 1500)
    await doAct('rita', id, 'submit')
    expect(await mailFor('mo', id)).toEqual([['approval_needed', 'Approval needed: Email test 1500']])

    await doAct('mo', id, 'approve')
    expect(await mailFor('fay', id)).toEqual([
      ['approval_needed', 'Finance approval needed: Email test 1500'],
    ])
    expect(await mailFor('mo', id)).toHaveLength(1) // the manager isn't asked again

    await doAct('fay', id, 'approve', 'Within budget.')
    const approved = await ctx.db.emailMessage.findFirstOrThrow({
      where: { requestId: id, kind: 'approved' },
    })
    expect(approved.toAddress).toBe('rita@example.com')
    expect(approved.text).toContain('Fay Nguyen wrote: “Within budget.”')
    expect(approved.text).toContain(`http://localhost:5174/#/requests/${id}`)
  })

  it('passes the comment on when a request is sent back or rejected', async () => {
    const id = await newRequest('sam', 200)
    await doAct('sam', id, 'submit')
    await doAct('mo', id, 'request_changes', 'Add the quote.')
    expect(await mailFor('sam', id)).toEqual([['changes_requested', 'Changes requested: Email test 200']])
    await doAct('sam', id, 'submit')
    expect((await mailFor('mo', id)).map(([kind]) => kind)).toEqual([
      'approval_needed',
      'approval_needed',
    ])
    await doAct('mo', id, 'reject', 'Not this quarter.')
    const rejected = await ctx.db.emailMessage.findFirstOrThrow({ where: { requestId: id, kind: 'rejected' } })
    expect(rejected.text).toContain('Not this quarter.')
  })

  it('tells the manager when a request waiting on them is cancelled', async () => {
    const id = await newRequest('rita', 300)
    await doAct('rita', id, 'submit')
    await doAct('rita', id, 'cancel')
    expect((await mailFor('mo', id)).map(([kind]) => kind)).toEqual(['approval_needed', 'cancelled'])
  })

  it('sends nothing when the action is refused', async () => {
    const id = await newRequest('rita', 300)
    await doAct('rita', id, 'submit')
    await doAct('sam', id, 'approve') // not her manager
    expect(await ctx.db.emailMessage.count({ where: { requestId: id } })).toBe(1)
  })

  it('seeds a realistic inbox for each persona', async () => {
    expect((await mailFor('mo')).map(([, subject]) => subject)).toContain(
      'Approval needed: Monitors for the design review room',
    )
    expect((await mailFor('fay')).map(([, subject]) => subject)).toContain(
      'Rejected: Accounting software add-on',
    )
  })
})

describe('the in-app inbox', () => {
  it('shows people only their own email, and marks it read', async () => {
    const inbox = (await ctx.as('mo').get('/api/emails')).body
    expect(inbox.emails.length).toBeGreaterThan(0)
    expect(inbox.emails.every((e: { text: string }) => e.text.startsWith('Hi Mo,'))).toBe(true)

    const first = inbox.emails[0].id
    expect((await ctx.as('sam').post(`/api/emails/${first}/read`)).body.updated).toBe(0)
    expect((await ctx.as('mo').post(`/api/emails/${first}/read`)).body.updated).toBe(1)
    expect((await ctx.as('mo').get('/api/emails')).body.unread).toBe(inbox.unread - 1)
  })
})

describe('delivery', () => {
  beforeEach(async () => {
    // Start each case from a clean slate of pending emails
    await ctx.db.emailMessage.updateMany({ where: { status: 'pending' }, data: { status: 'logged' } })
  })

  it('delivers each pending email once, even with two workers at the same time', async () => {
    const id = await newRequest('rita', 1500)
    await doAct('rita', id, 'submit')
    await doAct('mo', id, 'approve')
    const sent: string[] = []
    const mailer: Mailer = {
      send: async (m) => {
        sent.push(m.subject)
        await new Promise((r) => setTimeout(r, 20))
        return 'sent'
      },
    }
    await Promise.all([deliverPending(ctx.db, mailer), deliverPending(ctx.db, mailer)])
    expect(sent.sort()).toEqual(['Approval needed: Email test 1500', 'Finance approval needed: Email test 1500'])
    expect(await ctx.db.emailMessage.count({ where: { requestId: id, status: 'sent' } })).toBe(2)
  })

  it('retries a failure later, and gives up after the last attempt', async () => {
    const id = await newRequest('rita', 200)
    await doAct('rita', id, 'submit')
    const broken: Mailer = { send: async () => Promise.reject(new Error('provider down')) }

    let now = new Date()
    await deliverPending(ctx.db, broken, 20, now)
    let email = await ctx.db.emailMessage.findFirstOrThrow({ where: { requestId: id } })
    expect(email).toMatchObject({ status: 'pending', attempts: 1, lastError: 'provider down' })
    expect(email.nextAttempt.getTime()).toBe(now.getTime() + backoffMs(1))

    // Not retried before its time
    expect((await deliverPending(ctx.db, broken, 20, now)).claimed).toBe(0)

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      now = new Date(email.nextAttempt.getTime() + 1)
      await deliverPending(ctx.db, broken, 20, now)
      email = await ctx.db.emailMessage.findFirstOrThrow({ where: { requestId: id } })
    }
    expect(email).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS })
  })
})
