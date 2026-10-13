import type { DecisionRecord, RequestDetail } from './api'

export type StepState = 'done' | 'current' | 'upcoming' | 'rejected' | 'returned' | 'stopped'

export type ProgressStep = {
  key: 'submitted' | 'manager' | 'finance' | 'approved'
  label: string
  state: StepState
  /** Who decided, or who it's waiting on. */
  who?: string
  when?: string
}

/** Decisions since the last submission: a resubmitted request starts its approvals again. */
function currentRound(r: RequestDetail): DecisionRecord[] {
  const since = r.submittedAt ? new Date(r.submittedAt).getTime() : 0
  return r.decisions.filter((d) => new Date(d.createdAt).getTime() >= since)
}

/** The approval path as steps for the tracker: what's done, what's next, where it stopped. */
export function progress(r: RequestDetail): ProgressStep[] {
  const round = currentRound(r)
  const decided = (step: 'manager' | 'finance') => round.find((d) => d.step === step)
  const manager = decided('manager')
  const finance = decided('finance')

  const steps: ProgressStep[] = [
    {
      key: 'submitted',
      label: r.status === 'draft' ? 'Draft' : 'Submitted',
      state: r.status === 'draft' ? 'current' : 'done',
      who: r.requester.name,
      when: r.submittedAt ?? undefined,
    },
    {
      key: 'manager',
      label: 'Manager',
      state: 'upcoming',
      who: manager?.actor.name ?? r.manager?.name,
      when: manager?.createdAt,
    },
  ]
  if (r.financeRequired) {
    steps.push({
      key: 'finance',
      label: 'Finance',
      state: 'upcoming',
      who: finance?.actor.name ?? 'Finance team',
      when: finance?.createdAt,
    })
  }
  steps.push({ key: 'approved', label: 'Approved', state: 'upcoming' })

  const mark = (key: ProgressStep['key'], state: StepState) => {
    const step = steps.find((s) => s.key === key)
    if (step) step.state = state
  }
  const markDecision = (d: DecisionRecord | undefined, key: 'manager' | 'finance') => {
    if (!d) return
    mark(key, d.action === 'approve' ? 'done' : d.action === 'reject' ? 'rejected' : 'returned')
  }

  switch (r.status) {
    case 'pending_manager':
      mark('manager', 'current')
      break
    case 'pending_finance':
      markDecision(manager, 'manager')
      mark('finance', 'current')
      break
    case 'approved':
      markDecision(manager, 'manager')
      markDecision(finance, 'finance')
      mark('approved', 'done')
      break
    case 'rejected':
    case 'changes_requested':
      // The latest decision is the one that stopped it; earlier steps in the round passed
      markDecision(manager, 'manager')
      markDecision(finance, 'finance')
      if (r.status === 'changes_requested') mark('submitted', 'current')
      break
    case 'cancelled':
      markDecision(manager, 'manager')
      mark('approved', 'stopped')
      break
  }
  return steps
}
