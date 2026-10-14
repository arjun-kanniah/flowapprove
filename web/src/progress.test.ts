import { describe, expect, it } from 'vitest'
import type { DecisionRecord, RequestDetail } from './api'
import { progress } from './progress'

const person = (name: string) => ({ id: name, name })

function request(patch: Partial<RequestDetail>): RequestDetail {
  return {
    id: 'r1',
    title: 'Docks',
    vendor: 'Contoso',
    category: 'Hardware',
    amountCents: 86_000,
    currency: 'USD',
    status: 'draft',
    requester: person('Rita'),
    manager: person('Mo'),
    updatedAt: '2026-10-13T10:00:00Z',
    createdAt: '2026-10-13T09:00:00Z',
    submittedAt: null,
    closedAt: null,
    description: '',
    attachments: [],
    history: [],
    actions: [],
    canEdit: false,
    waitingOn: null,
    decisions: [],
    financeRequired: false,
    financeThresholdCents: 100_000,
    quoteChecks: [],
    quoteCheckAvailable: false,
    ...patch,
  }
}

const decision = (
  step: DecisionRecord['step'],
  action: DecisionRecord['action'],
  who: string,
  at = '2026-10-13T11:00:00Z',
): DecisionRecord => ({ step, action, comment: '', actor: person(who), createdAt: at })

const states = (r: RequestDetail) => progress(r).map((s) => `${s.key}:${s.state}`)

describe('progress', () => {
  it('shows a draft at the first step, with no finance step below the threshold', () => {
    expect(states(request({}))).toEqual([
      'submitted:current',
      'manager:upcoming',
      'approved:upcoming',
    ])
  })

  it('adds the finance step when the amount needs it, and marks where it waits', () => {
    const r = request({
      status: 'pending_finance',
      financeRequired: true,
      submittedAt: '2026-10-13T10:00:00Z',
      decisions: [decision('manager', 'approve', 'Mo')],
    })
    expect(states(r)).toEqual([
      'submitted:done',
      'manager:done',
      'finance:current',
      'approved:upcoming',
    ])
    expect(progress(r)[1]!.who).toBe('Mo')
  })

  it('marks the step that rejected it', () => {
    const r = request({
      status: 'rejected',
      submittedAt: '2026-10-13T10:00:00Z',
      decisions: [decision('manager', 'reject', 'Mo')],
    })
    expect(states(r)).toContain('manager:rejected')
  })

  it('starts over after a resubmission, ignoring the earlier round', () => {
    const r = request({
      status: 'pending_manager',
      submittedAt: '2026-10-13T12:00:00Z',
      decisions: [decision('manager', 'request_changes', 'Mo', '2026-10-13T11:00:00Z')],
    })
    expect(states(r)).toEqual(['submitted:done', 'manager:current', 'approved:upcoming'])
  })

  it('sends a request back to the requester when changes are asked for', () => {
    const r = request({
      status: 'changes_requested',
      submittedAt: '2026-10-13T10:00:00Z',
      decisions: [decision('manager', 'request_changes', 'Mo')],
    })
    expect(states(r)).toEqual(['submitted:current', 'manager:returned', 'approved:upcoming'])
  })
})
