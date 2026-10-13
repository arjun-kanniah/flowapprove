/**
 * The approval rules for a purchase request, as pure functions: who may do what, and what
 * status it leads to. Routes and the UI both ask `decide` / `allowedActions`, so the rules live
 * in one place and are tested on their own.
 *
 *   draft ──submit──▶ pending_manager ──approve──▶ pending_finance ──approve──▶ approved
 *                          │                (amount ≥ threshold;          │
 *                          │                 otherwise straight to        │
 *                          │                 approved)                    │
 *                          ├──reject──▶ rejected ◀──reject────────────────┤
 *                          └──request_changes──▶ changes_requested ◀──────┘
 *                                                      │
 *                                                      └──submit──▶ pending_manager
 *
 * The requester can cancel while the request is open. Separation of duties: nobody approves
 * their own request, and the finance approver must be someone other than the manager who
 * approved it. Admins manage users; they get no approval powers of their own.
 */

export const ROLES = ['requester', 'manager', 'finance', 'admin'] as const
export type Role = (typeof ROLES)[number]

export const STATUSES = [
  'draft',
  'pending_manager',
  'pending_finance',
  'changes_requested',
  'approved',
  'rejected',
  'cancelled',
] as const
export type Status = (typeof STATUSES)[number]

export const ACTIONS = ['submit', 'approve', 'reject', 'request_changes', 'cancel'] as const
export type Action = (typeof ACTIONS)[number]

export type Step = 'manager' | 'finance'

export interface Actor {
  id: string
  roles: readonly Role[]
}

export interface RequestState {
  status: Status
  requesterId: string
  /** The requester's manager, who approves the first step. */
  managerId: string | null
  /** Who approved the manager step, once it has been approved. */
  managerApproverId: string | null
  amountCents: number
}

export interface Policy {
  /** Requests at or above this amount also need finance approval. */
  financeThresholdCents: number
}

export type Decision =
  | { ok: true; next: Status; step: Step | null }
  | { ok: false; reason: string }

const OPEN: readonly Status[] = ['draft', 'pending_manager', 'pending_finance', 'changes_requested']

export function isOpen(status: Status): boolean {
  return OPEN.includes(status)
}

/** The step a pending request is waiting on, if any. */
export function currentStep(status: Status): Step | null {
  if (status === 'pending_manager') return 'manager'
  if (status === 'pending_finance') return 'finance'
  return null
}

function deny(reason: string): Decision {
  return { ok: false, reason }
}

/** Whether `actor` may decide the step the request is waiting on, and why not if they can't. */
function approverCheck(request: RequestState, actor: Actor): string | null {
  const step = currentStep(request.status)
  if (step === null) return 'This request is not waiting for approval.'
  if (actor.id === request.requesterId) return 'You can’t approve your own request.'
  if (step === 'manager' && actor.id !== request.managerId) {
    return 'Only the requester’s manager can decide this step.'
  }
  if (step === 'finance') {
    if (!actor.roles.includes('finance')) return 'Only finance can decide this step.'
    if (actor.id === request.managerApproverId) {
      return 'The finance step needs someone other than the manager who approved it.'
    }
  }
  return null
}

export function decide(
  request: RequestState,
  actor: Actor,
  action: Action,
  policy: Policy,
): Decision {
  switch (action) {
    case 'submit': {
      if (actor.id !== request.requesterId) return deny('Only the requester can submit.')
      if (request.status !== 'draft' && request.status !== 'changes_requested') {
        return deny('Only a draft or a request sent back for changes can be submitted.')
      }
      if (request.amountCents <= 0) return deny('The amount must be more than zero.')
      if (request.managerId === null) {
        return deny('You have no manager to approve this. Ask an admin to assign one.')
      }
      return { ok: true, next: 'pending_manager', step: null }
    }
    case 'approve': {
      const problem = approverCheck(request, actor)
      if (problem) return deny(problem)
      const step = currentStep(request.status)
      const needsFinance =
        step === 'manager' && request.amountCents >= policy.financeThresholdCents
      return { ok: true, next: needsFinance ? 'pending_finance' : 'approved', step }
    }
    case 'reject':
    case 'request_changes': {
      const problem = approverCheck(request, actor)
      if (problem) return deny(problem)
      const next = action === 'reject' ? 'rejected' : 'changes_requested'
      return { ok: true, next, step: currentStep(request.status) }
    }
    case 'cancel': {
      if (actor.id !== request.requesterId) return deny('Only the requester can cancel.')
      if (!isOpen(request.status)) return deny('This request is already closed.')
      return { ok: true, next: 'cancelled', step: null }
    }
  }
}

/** The actions `actor` can take on the request right now, for the UI's buttons. */
export function allowedActions(request: RequestState, actor: Actor, policy: Policy): Action[] {
  return ACTIONS.filter((action) => decide(request, actor, action, policy).ok)
}
