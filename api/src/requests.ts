import type { Db } from './db.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'
import type { Prisma, PurchaseRequest, User } from './generated/prisma/client.js'
import {
  type Action,
  type Actor,
  allowedActions,
  currentStep,
  decide,
  isOpen,
  type Policy,
  type RequestState,
} from './workflow.js'

/** Something changed that people looking at a request should see: published as a live update. */
export interface RequestEvent {
  requestId: string
  title: string
  status: PurchaseRequest['status']
  action: string
  actorId: string
  actorName: string
  /** Everyone who can see the request and should be told. */
  audience: { userIds: string[]; roles: ('finance' | 'admin')[] }
}

export type Publish = (event: RequestEvent) => void

export interface RequestInput {
  title: string
  description: string
  vendor: string
  category: string
  amountCents: number
}

export function actorOf(user: User): Actor {
  return { id: user.id, roles: user.roles }
}

function stateOf(request: PurchaseRequest): RequestState {
  return {
    status: request.status,
    requesterId: request.requesterId,
    managerId: request.managerId,
    managerApproverId: request.managerApproverId,
    amountCents: request.amountCents,
  }
}

/**
 * Who may see a request: its requester always; once it has been submitted, the manager who
 * decides it and finance; admins always. A draft stays private until it is submitted.
 */
export function canView(request: PurchaseRequest, user: User): boolean {
  if (request.requesterId === user.id || user.roles.includes('admin')) return true
  if (request.status === 'draft') return false
  return request.managerId === user.id || user.roles.includes('finance')
}

function audienceOf(request: PurchaseRequest): RequestEvent['audience'] {
  const userIds = [request.requesterId, request.managerId].filter((id): id is string => !!id)
  return { userIds: [...new Set(userIds)], roles: ['finance', 'admin'] }
}

export async function createRequest(
  db: Db,
  user: User,
  input: RequestInput,
  publish: Publish,
): Promise<PurchaseRequest> {
  const request = await db.$transaction(async (tx) => {
    const created = await tx.purchaseRequest.create({
      data: { ...input, requesterId: user.id, managerId: user.managerId },
    })
    await tx.auditEvent.create({
      data: {
        requestId: created.id,
        actorId: user.id,
        action: 'created',
        toStatus: 'draft',
        details: { amountCents: input.amountCents, vendor: input.vendor },
      },
    })
    return created
  })
  publish({
    requestId: request.id,
    title: request.title,
    status: request.status,
    action: 'created',
    actorId: user.id,
    actorName: user.name,
    audience: { userIds: [user.id], roles: [] },
  })
  return request
}

/** Edit a draft, or a request sent back for changes. Only its requester can. */
export async function updateRequest(
  db: Db,
  user: User,
  id: string,
  input: Partial<RequestInput>,
  publish: Publish,
): Promise<PurchaseRequest> {
  const request = await db.$transaction(async (tx) => {
    const current = await lockRequest(tx, id)
    if (!canView(current, user)) throw notFound('Request not found')
    if (current.requesterId !== user.id) throw forbidden('Only the requester can edit this.')
    if (current.status !== 'draft' && current.status !== 'changes_requested') {
      throw conflict('Only a draft or a request sent back for changes can be edited.')
    }
    const changed = Object.fromEntries(
      Object.entries(input).filter(([key, value]) => current[key as keyof RequestInput] !== value),
    )
    if (Object.keys(changed).length === 0) return current
    const updated = await tx.purchaseRequest.update({ where: { id }, data: changed })
    await tx.auditEvent.create({
      data: {
        requestId: id,
        actorId: user.id,
        action: 'edited',
        details: {
          changed: Object.fromEntries(
            Object.keys(changed).map((key) => [
              key,
              { from: current[key as keyof RequestInput], to: changed[key] },
            ]),
          ),
        } as Prisma.InputJsonValue,
      },
    })
    return updated
  })
  publish({
    requestId: id,
    title: request.title,
    status: request.status,
    action: 'edited',
    actorId: user.id,
    actorName: user.name,
    audience: audienceOf(request),
  })
  return request
}

/**
 * Take an action on a request: the approval rules decide, and the status change, the decision
 * and the audit entry are written together. The row is locked first, so two approvers acting
 * at the same moment are handled one after the other, and the second sees the new state.
 */
export async function act(
  db: Db,
  user: User,
  id: string,
  action: Action,
  comment: string,
  policy: Policy,
  publish: Publish,
): Promise<PurchaseRequest> {
  const needsComment = action === 'reject' || action === 'request_changes'
  if (needsComment && !comment.trim()) {
    throw badRequest('Add a comment so the requester knows why.')
  }

  const request = await db.$transaction(async (tx) => {
    const current = await lockRequest(tx, id)
    if (!canView(current, user)) throw notFound('Request not found')

    const state = stateOf(current)
    if (action === 'submit') {
      // The manager is whoever manages the requester now, not when the draft was started
      const requester = await tx.user.findUniqueOrThrow({ where: { id: current.requesterId } })
      state.managerId = requester.managerId
    }
    const decision = decide(state, actorOf(user), action, policy)
    if (!decision.ok) throw forbidden(decision.reason)

    const now = new Date()
    const updated = await tx.purchaseRequest.update({
      where: { id },
      data: {
        status: decision.next,
        ...(action === 'submit' && { managerId: state.managerId, submittedAt: now }),
        ...(action === 'submit' && { managerApproverId: null }),
        ...(action === 'approve' && decision.step === 'manager' && { managerApproverId: user.id }),
        ...(!isOpen(decision.next) && { closedAt: now }),
      },
    })
    if (decision.step && action !== 'submit' && action !== 'cancel') {
      await tx.decision.create({
        data: { requestId: id, step: decision.step, action, actorId: user.id, comment },
      })
    }
    await tx.auditEvent.create({
      data: {
        requestId: id,
        actorId: user.id,
        action,
        fromStatus: current.status,
        toStatus: decision.next,
        details: comment ? { comment } : {},
      },
    })
    return updated
  })

  publish({
    requestId: id,
    title: request.title,
    status: request.status,
    action,
    actorId: user.id,
    actorName: user.name,
    audience: audienceOf(request),
  })
  return request
}

async function lockRequest(tx: Prisma.TransactionClient, id: string): Promise<PurchaseRequest> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM purchase_requests WHERE id = ${id}::uuid FOR UPDATE`
  if (locked.length === 0) throw notFound('Request not found')
  return tx.purchaseRequest.findUniqueOrThrow({ where: { id } })
}

export type View = 'mine' | 'inbox' | 'all'

/** Requests for a list: the user's own, the ones waiting on them, or everything they may see. */
export function listWhere(view: View, user: User): Prisma.PurchaseRequestWhereInput {
  switch (view) {
    case 'mine':
      return { requesterId: user.id }
    case 'inbox': {
      const waiting: Prisma.PurchaseRequestWhereInput[] = [
        { status: 'pending_manager', managerId: user.id, requesterId: { not: user.id } },
      ]
      if (user.roles.includes('finance')) {
        waiting.push({
          status: 'pending_finance',
          requesterId: { not: user.id },
          OR: [{ managerApproverId: null }, { managerApproverId: { not: user.id } }],
        })
      }
      return { OR: waiting }
    }
    case 'all':
      if (user.roles.includes('admin')) return {}
      if (user.roles.includes('finance')) return { status: { not: 'draft' } }
      throw forbidden('Only finance and admins can see every request.')
  }
}

/** What the signed-in user can do with a request, for the UI's buttons. */
export function actionsFor(
  request: PurchaseRequest,
  user: User,
  policy: Policy,
): { actions: Action[]; canEdit: boolean; waitingOn: 'manager' | 'finance' | null } {
  return {
    actions: allowedActions(stateOf(request), actorOf(user), policy),
    canEdit:
      request.requesterId === user.id &&
      (request.status === 'draft' || request.status === 'changes_requested'),
    waitingOn: currentStep(request.status),
  }
}
