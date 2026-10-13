import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setUp, tearDown, type TestContext } from './helpers.js'

let ctx: TestContext
beforeAll(async () => {
  ctx = await setUp()
})
afterAll(async () => tearDown(ctx))

const PDF = Buffer.from('%PDF-1.7\n% a tiny test quote\n%%EOF\n')

function multipart(filename: string, data: Buffer) {
  const boundary = '----flowapprovetest'
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`
  return {
    payload: Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

async function upload(who: string, requestId: string, filename: string, data: Buffer) {
  const { payload, headers } = multipart(filename, data)
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/requests/${requestId}/attachments`,
    payload,
    headers: { ...headers, cookie: await ctx.cookieFor(who) },
  })
  return { status: res.statusCode, body: res.json() }
}

async function draft(who: string) {
  const res = await ctx.as(who).post('/api/requests', {
    title: 'Quote test',
    vendor: 'Contoso',
    category: 'Hardware',
    amount: 300,
  })
  return res.body.id as string
}

describe('attachments', () => {
  it('stores a PDF quote, records it, and serves it to the approver after submitting', async () => {
    const id = await draft('rita')
    const added = await upload('rita', id, 'quote.pdf', PDF)
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({ filename: 'quote.pdf', sizeBytes: PDF.length })

    await ctx.as('rita').post(`/api/requests/${id}/actions`, { action: 'submit' })
    const file = await ctx.app.inject({
      method: 'GET',
      url: `/api/attachments/${added.body.id}`,
      headers: { cookie: await ctx.cookieFor('mo') },
    })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('application/pdf')
    expect(file.headers['x-content-type-options']).toBe('nosniff')
    expect(file.rawPayload.equals(PDF)).toBe(true)

    const history = (await ctx.as('rita').get(`/api/requests/${id}`)).body.history
    expect(history.map((h: { action: string }) => h.action)).toContain('file_added')
  })

  it('accepts only PDFs, judged by content rather than name', async () => {
    const id = await draft('rita')
    const fake = await upload('rita', id, 'invoice.pdf', Buffer.from('<html>not a pdf</html>'))
    expect(fake.status).toBe(400)
    expect(fake.body.detail).toMatch(/Only PDF/)
  })

  it('hides files from people who can’t see the request', async () => {
    const id = await draft('rita')
    const added = await upload('rita', id, 'quote.pdf', PDF)
    await ctx.as('rita').post(`/api/requests/${id}/actions`, { action: 'submit' })
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/attachments/${added.body.id}`,
      headers: { cookie: await ctx.cookieFor('sam') },
    })
    expect(res.statusCode).toBe(404)
  })

  it('freezes files once submitted', async () => {
    const id = await draft('rita')
    await upload('rita', id, 'quote.pdf', PDF)
    await ctx.as('rita').post(`/api/requests/${id}/actions`, { action: 'submit' })
    expect((await upload('rita', id, 'second.pdf', PDF)).status).toBe(409)
  })

  it('lets the requester remove a file from a draft', async () => {
    const id = await draft('rita')
    const added = await upload('rita', id, 'quote.pdf', PDF)
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/attachments/${added.body.id}`,
      headers: { cookie: await ctx.cookieFor('rita') },
    })
    expect(res.statusCode).toBe(204)
    expect((await ctx.as('rita').get(`/api/requests/${id}`)).body.attachments).toEqual([])
  })
})
