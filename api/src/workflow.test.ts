import { describe, expect, it } from 'vitest'
import {
  type Action,
  type Actor,
  allowedActions,
  decide,
  type Policy,
  type RequestState,
  type Status,
} from './workflow.js'

const policy: Policy = { financeThresholdCents: 100_000 } // $1,000

const requester: Actor = { id: 'rita', roles: ['requester'] }
const manager: Actor = { id: 'mo', roles: ['requester', 'manager'] }
const otherManager: Actor = { id: 'max', roles: ['requester', 'manager'] }
const finance: Actor = { id: 'fay', roles: ['requester', 'finance'] }
const managerInFinance: Actor = { id: 'mo', roles: ['requester', 'manager', 'finance'] }
const admin: Actor = { id: 'ada', roles: ['admin'] }

function request(patch: Partial<RequestState> = {}): RequestState {
  return {
    status: 'draft',
    requesterId: 'rita',
    managerId: 'mo',
    managerApproverId: null,
    amountCents: 50_000,
    ...patch,
  }
}

function next(state: RequestState, actor: Actor, action: Action): Status | string {
  const result = decide(state, actor, action, policy)
  return result.ok ? result.next : `denied: ${result.reason}`
}

describe('the approval path', () => {
  it('sends a small request from the manager straight to approved', () => {
    expect(next(request(), requester, 'submit')).toBe('pending_manager')
    expect(next(request({ status: 'pending_manager' }), manager, 'approve')).toBe('approved')
  })

  it('adds a finance step at or above the threshold', () => {
    const big = request({ status: 'pending_manager', amountCents: 100_000 })
    expect(next(big, manager, 'approve')).toBe('pending_finance')
    const atFinance = { ...big, status: 'pending_finance' as const, managerApproverId: 'mo' }
    expect(next(atFinance, finance, 'approve')).toBe('approved')
  })

  it('stays below the threshold by a cent', () => {
    const justUnder = request({ status: 'pending_manager', amountCents: 99_999 })
    expect(next(justUnder, manager, 'approve')).toBe('approved')
  })

  it('reports which step a decision closed', () => {
    const result = decide(request({ status: 'pending_manager' }), manager, 'reject', policy)
    expect(result).toEqual({ ok: true, next: 'rejected', step: 'manager' })
  })

  it('lets either approver reject or send back for changes, and the requester resubmit', () => {
    const atManager = request({ status: 'pending_manager' })
    expect(next(atManager, manager, 'reject')).toBe('rejected')
    expect(next(atManager, manager, 'request_changes')).toBe('changes_requested')
    const atFinance = request({ status: 'pending_finance', managerApproverId: 'mo' })
    expect(next(atFinance, finance, 'request_changes')).toBe('changes_requested')
    expect(next(request({ status: 'changes_requested' }), requester, 'submit')).toBe(
      'pending_manager',
    )
  })
})

describe('who may act', () => {
  it('stops anyone approving their own request, even a manager', () => {
    const own = request({ status: 'pending_manager', requesterId: 'mo', managerId: 'mo' })
    expect(next(own, manager, 'approve')).toMatch(/own request/)
  })

  it('allows only the requester’s own manager at the manager step', () => {
    expect(next(request({ status: 'pending_manager' }), otherManager, 'approve')).toMatch(
      /requester’s manager/,
    )
  })

  it('allows only finance at the finance step', () => {
    const atFinance = request({ status: 'pending_finance', managerApproverId: 'mo' })
    expect(next(atFinance, otherManager, 'approve')).toMatch(/Only finance/)
  })

  it('needs a different person for the finance step than for the manager step', () => {
    const atFinance = request({ status: 'pending_finance', managerApproverId: 'mo' })
    expect(next(atFinance, managerInFinance, 'approve')).toMatch(/someone other than/)
  })

  it('gives admins no approval powers', () => {
    expect(allowedActions(request({ status: 'pending_manager' }), admin, policy)).toEqual([])
  })

  it('lets only the requester submit or cancel', () => {
    expect(next(request(), manager, 'submit')).toMatch(/Only the requester/)
    expect(next(request({ status: 'pending_manager' }), manager, 'cancel')).toMatch(
      /Only the requester/,
    )
  })
})

describe('guards', () => {
  it('refuses to submit without a manager or with no amount', () => {
    expect(next(request({ managerId: null }), requester, 'submit')).toMatch(/no manager/)
    expect(next(request({ amountCents: 0 }), requester, 'submit')).toMatch(/more than zero/)
  })

  it('treats approved, rejected and cancelled as final', () => {
    for (const status of ['approved', 'rejected', 'cancelled'] as const) {
      const closed = request({ status })
      expect(allowedActions(closed, requester, policy)).toEqual([])
      expect(allowedActions(closed, manager, policy)).toEqual([])
    }
  })

  it('refuses decisions on a request that isn’t waiting for one', () => {
    expect(next(request(), manager, 'approve')).toMatch(/not waiting/)
  })
})

describe('allowedActions', () => {
  it('lists what each person can do at each stage', () => {
    expect(allowedActions(request(), requester, policy)).toEqual(['submit', 'cancel'])
    const atManager = request({ status: 'pending_manager' })
    expect(allowedActions(atManager, requester, policy)).toEqual(['cancel'])
    expect(allowedActions(atManager, manager, policy)).toEqual([
      'approve',
      'reject',
      'request_changes',
    ])
    expect(allowedActions(atManager, finance, policy)).toEqual([])
  })
})
