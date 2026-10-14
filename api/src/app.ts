import { createHash, randomBytes } from 'node:crypto'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  addAttachment,
  MAX_ATTACHMENT_BYTES,
  readAttachment,
  removeAttachment,
} from './attachments.js'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { EntraProfile, EntraSignIn } from './entra.js'
import { badRequest, HttpError, notFound, unauthorized } from './errors.js'
import { Prisma, type User } from './generated/prisma/client.js'
import {
  act,
  actionsFor,
  canView,
  createRequest,
  listWhere,
  type Publish,
  updateRequest,
} from './requests.js'
import { checkTarget, type QuoteChecker, runQuoteCheck } from './quote/check.js'
import { HourlyLimit } from './ratelimit.js'
import type { Storage } from './storage.js'
import { ACTIONS, type Policy } from './workflow.js'

export const VERSION = '0.1.0'
export const SESSION_COOKIE = 'fa_session'
/** Holds the state, nonce and PKCE verifier between leaving for Microsoft and coming back. */
const ENTRA_COOKIE = 'fa_entra'
const ENTRA_PATH = '/api/auth/entra'
/** On the demo, people who sign in with Microsoft report to Mo, so they can approve as Mo. */
const DEMO_VISITOR_MANAGER = 'mo@example.com'
const SESSION_DAYS = 7

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null
  }
}

const RequestBody = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000).default(''),
  vendor: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  /** Dollars, up to two decimals. */
  amount: z.number().positive().max(1_000_000).multipleOf(0.01),
})

const ActionBody = z.object({
  action: z.enum(ACTIONS),
  comment: z.string().trim().max(2000).default(''),
})

const ListQuery = z.object({ view: z.enum(['mine', 'inbox', 'all']).default('mine') })
const IdParams = z.object({ id: z.uuid() })

function toInput(body: z.infer<typeof RequestBody>) {
  const { amount, ...rest } = body
  return { ...rest, amountCents: Math.round(amount * 100) }
}

function person(user: Pick<User, 'id' | 'name'> | null) {
  return user ? { id: user.id, name: user.name } : null
}

export interface AppDeps {
  config: Config
  db: Db
  storage: Storage
  /** Sends live updates; main.ts connects it to Socket.IO once the server exists. */
  publish?: Publish
  /** Reads quotes with a model; null when no model is configured. */
  quoteChecker?: QuoteChecker | null
  /** Sign-in with Microsoft accounts; null when it isn't configured. */
  entra?: EntraSignIn | null
}

/** The HTTP app, built separately from main.ts so tests can call it without a network port. */
export function buildApp({
  config,
  db,
  storage,
  publish = () => {},
  quoteChecker = null,
  entra = null,
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' })
  const policy: Policy = { financeThresholdCents: config.financeThresholdCents }
  const secure = config.NODE_ENV === 'production'
  const checkLimit = new HourlyLimit(config.QUOTE_CHECKS_PER_HOUR)
  const mail = { appUrl: config.APP_URL }

  app.register(cookie, { secret: config.SESSION_SECRET })
  app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } })
  app.decorateRequest('user', null)

  // Who is signed in: a signed session cookie that holds the user's id
  app.addHook('preHandler', async (request) => {
    const raw = request.cookies[SESSION_COOKIE]
    if (!raw) return
    const unsigned = request.unsignCookie(raw)
    if (!unsigned.valid || !unsigned.value) return
    request.user = await db.user.findUnique({ where: { id: unsigned.value } })
  })

  function signedIn(request: FastifyRequest): User {
    if (!request.user) throw unauthorized()
    return request.user
  }

  function startSession(reply: FastifyReply, user: User) {
    reply.setCookie(SESSION_COOKIE, user.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      signed: true,
      maxAge: SESSION_DAYS * 24 * 3600,
    })
  }

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ detail: error.message })
    }
    if (error instanceof z.ZodError) {
      const issue = error.issues[0]
      const where = issue?.path.join('.')
      return reply.status(400).send({ detail: where ? `${where}: ${issue?.message}` : issue?.message })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ detail: error.message })
    }
    request.log.error(error)
    return reply.status(500).send({ detail: 'Something went wrong.' })
  })

  app.get('/api/health', async () => {
    await db.$queryRaw`SELECT 1`
    return {
      status: 'ok',
      version: VERSION,
      demo: config.DEMO_MODE,
      auth: config.AUTH_MODE,
      entra: entra !== null,
      email: config.EMAIL_DELIVERY,
    }
  })

  // --- Signing in -----------------------------------------------------------------------

  app.get('/api/auth/personas', async () => {
    if (config.AUTH_MODE !== 'demo') throw notFound()
    const personas = await db.user.findMany({
      where: { isDemo: true },
      include: { manager: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    })
    return personas.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      roles: p.roles,
      manager: person(p.manager),
    }))
  })

  app.post('/api/auth/demo', async (request, reply) => {
    if (config.AUTH_MODE !== 'demo') throw notFound()
    const { userId } = z.object({ userId: z.uuid() }).parse(request.body)
    const user = await db.user.findFirst({ where: { id: userId, isDemo: true } })
    if (!user) throw notFound('No such persona')
    startSession(reply, user)
    return { id: user.id, name: user.name }
  })

  // --- Signing in with Microsoft (OpenID Connect, authorization code flow with PKCE) -----

  const entraRedirectUri = `${config.APP_URL.replace(/\/$/, '')}${ENTRA_PATH}/callback`
  const randomToken = () => randomBytes(32).toString('base64url')
  const PendingSignIn = z.object({ state: z.string(), nonce: z.string(), verifier: z.string() })
  const CallbackQuery = z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
  })
  // Email claims aren't verified for every account type, so an existing account is matched by
  // email only when sign-in is limited to one organisation's tenant
  const singleTenant = !['common', 'organizations', 'consumers'].includes(config.ENTRA_TENANT)

  /** The person's account, created the first time they sign in. */
  async function entraUser(profile: EntraProfile): Promise<User | null> {
    const known = await db.user.findUnique({ where: { entraObjectId: profile.objectId } })
    if (known) return db.user.update({ where: { id: known.id }, data: { name: profile.name } })
    if (singleTenant) {
      const invited = await db.user.findFirst({
        where: { email: profile.email, entraObjectId: null, isDemo: false },
      })
      if (invited) {
        return db.user.update({ where: { id: invited.id }, data: { entraObjectId: profile.objectId } })
      }
    }
    const manager = config.DEMO_MODE
      ? await db.user.findFirst({ where: { email: DEMO_VISITOR_MANAGER, isDemo: true } })
      : null
    try {
      return await db.user.create({
        data: {
          entraObjectId: profile.objectId,
          name: profile.name,
          email: profile.email,
          roles: ['requester'],
          managerId: manager?.id ?? null,
        },
      })
    } catch (error) {
      // Someone else already has this email address
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null
      throw error
    }
  }

  app.get(`${ENTRA_PATH}/start`, async (_request, reply) => {
    if (!entra) throw notFound()
    const pending = { state: randomToken(), nonce: randomToken(), verifier: randomToken() }
    reply.setCookie(ENTRA_COOKIE, JSON.stringify(pending), {
      path: ENTRA_PATH,
      httpOnly: true,
      sameSite: 'lax', // sent on the redirect back from Microsoft, a top-level GET
      secure,
      signed: true,
      maxAge: 600,
    })
    const url = await entra.authUrl({
      redirectUri: entraRedirectUri,
      state: pending.state,
      nonce: pending.nonce,
      codeChallenge: createHash('sha256').update(pending.verifier).digest('base64url'),
    })
    return reply.redirect(url)
  })

  app.get(`${ENTRA_PATH}/callback`, async (request, reply) => {
    if (!entra) throw notFound()
    // Back to the sign-in page with a reason it can show
    const back = (why: string) => reply.redirect(`/?signin=${why}`)
    const query = CallbackQuery.parse(request.query)
    const raw = request.cookies[ENTRA_COOKIE]
    const unsigned = raw ? request.unsignCookie(raw) : null
    reply.clearCookie(ENTRA_COOKIE, { path: ENTRA_PATH })
    if (query.error) return back('cancelled')

    const pending = unsigned?.valid && unsigned.value ? PendingSignIn.safeParse(JSON.parse(unsigned.value)) : null
    if (!pending?.success || !query.code || query.state !== pending.data.state) return back('expired')

    let profile: EntraProfile
    try {
      profile = await entra.redeem({
        redirectUri: entraRedirectUri,
        code: query.code,
        nonce: pending.data.nonce,
        codeVerifier: pending.data.verifier,
      })
    } catch (error) {
      request.log.warn({ err: error }, 'Microsoft sign-in failed')
      return back('failed')
    }
    const user = await entraUser(profile)
    if (!user) return back('taken')
    startSession(reply, user)
    return reply.redirect('/')
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/me', async (request) => {
    const user = signedIn(request)
    const manager = user.managerId
      ? await db.user.findUnique({ where: { id: user.managerId } })
      : null
    return { id: user.id, name: user.name, email: user.email, roles: user.roles, manager: person(manager) }
  })

  // --- Requests -------------------------------------------------------------------------

  app.get('/api/requests', async (request) => {
    const user = signedIn(request)
    const { view } = ListQuery.parse(request.query)
    const rows = await db.purchaseRequest.findMany({
      where: listWhere(view, user),
      include: { requester: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    return rows.map(({ requester, ...r }) => ({ ...r, requester: person(requester) }))
  })

  app.post('/api/requests', async (request, reply) => {
    const user = signedIn(request)
    const created = await createRequest(db, user, toInput(RequestBody.parse(request.body)), publish)
    return reply.status(201).send(created)
  })

  app.get('/api/requests/:id', async (request) => {
    const user = signedIn(request)
    const { id } = IdParams.parse(request.params)
    const found = await db.purchaseRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        decisions: { include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
        auditEvents: { include: { actor: { select: { id: true, name: true } } }, orderBy: { id: 'asc' } },
        aiChecks: {
          include: { attachment: { select: { filename: true } } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    })
    if (!found || !canView(found, user)) throw notFound('Request not found')
    const { auditEvents, aiChecks, ...rest } = found
    return {
      ...rest,
      quoteChecks: aiChecks.map(({ attachment, ...check }) => ({
        ...check,
        filename: attachment.filename,
      })),
      quoteCheckAvailable: quoteChecker !== null,
      // BigInt ids don't serialize to JSON; the order is what matters
      history: auditEvents.map(({ id: _id, actor, ...event }) => ({ ...event, actor: person(actor) })),
      ...actionsFor(found, user, policy),
    }
  })

  app.patch('/api/requests/:id', async (request) => {
    const user = signedIn(request)
    const { id } = IdParams.parse(request.params)
    const body = RequestBody.partial().parse(request.body)
    const { amount, ...rest } = body
    const input = amount === undefined ? rest : { ...rest, amountCents: Math.round(amount * 100) }
    return updateRequest(db, user, id, input, publish)
  })

  app.post('/api/requests/:id/actions', async (request) => {
    const user = signedIn(request)
    const { id } = IdParams.parse(request.params)
    const { action, comment } = ActionBody.parse(request.body)
    const result = await act(db, user, id, action, comment, policy, publish, mail)
    if (action === 'submit') startCheckOnSubmit(user, id)
    return result
  })

  /** A submitted quote is checked in the background, so submitting stays instant. */
  function startCheckOnSubmit(user: User, id: string) {
    if (!quoteChecker || !checkLimit.take(user.id)) return
    void db.attachment
      .findFirst({ where: { requestId: id }, orderBy: { createdAt: 'desc' } })
      .then((latest) =>
        latest
          ? runQuoteCheck(db, storage, quoteChecker, id, latest.id, publish, user)
          : null,
      )
      .catch((error: unknown) => app.log.error({ err: error, requestId: id }, 'quote check failed'))
  }

  app.post('/api/requests/:id/quote-check', async (request, reply) => {
    const user = signedIn(request)
    const { id } = IdParams.parse(request.params)
    if (!quoteChecker) throw new HttpError(503, 'The quote check isn’t set up here.')
    const { attachment } = await checkTarget(db, user, id)
    if (!checkLimit.take(user.id)) {
      throw new HttpError(429, `You can run ${config.QUOTE_CHECKS_PER_HOUR} checks an hour. Try again later.`)
    }
    const check = await runQuoteCheck(db, storage, quoteChecker, id, attachment.id, publish, user)
    return reply.status(201).send(check)
  })

  // --- Emails: what each person was sent, shown in the app (the demo's addresses are fake) ---

  app.get('/api/emails', async (request) => {
    const user = signedIn(request)
    const emails = await db.emailMessage.findMany({
      where: { toUserId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        kind: true,
        subject: true,
        text: true,
        requestId: true,
        status: true,
        createdAt: true,
        readAt: true,
      },
    })
    return { emails, unread: emails.filter((e) => !e.readAt).length }
  })

  app.post('/api/emails/:id/read', async (request) => {
    const user = signedIn(request)
    const { id } = IdParams.parse(request.params)
    const { count } = await db.emailMessage.updateMany({
      where: { id, toUserId: user.id, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: count }
  })

  // --- Attachments ----------------------------------------------------------------------

  app.post('/api/requests/:id/attachments', async (request, reply) => {
    const user = signedIn(request)
    const { id } = IdParams.parse(request.params)
    const file = await request.file()
    if (!file) throw badRequest('Choose a file to upload.')
    const data = await file.toBuffer() // throws a 413 past the size limit
    const created = await addAttachment(db, storage, user, id, { filename: file.filename, data }, publish)
    return reply.status(201).send(created)
  })

  app.get('/api/attachments/:id', async (request, reply) => {
    const user = signedIn(request)
    const { id } = IdParams.parse(request.params)
    const { attachment, data } = await readAttachment(db, storage, user, id)
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${attachment.filename}"`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(data)
  })

  app.delete('/api/attachments/:id', async (request, reply) => {
    const user = signedIn(request)
    const { id } = IdParams.parse(request.params)
    await removeAttachment(db, storage, user, id, publish)
    return reply.status(204).send()
  })

  // --- The web app, in production: the API serves the built files from the same origin ---

  if (config.STATIC_DIR) {
    app.register(fastifyStatic, { root: config.STATIC_DIR, index: 'index.html' })
  }

  return app
}
