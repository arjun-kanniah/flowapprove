import type { Action, Status } from './api'

export function money(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export function when(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const minutes = Math.round((now.getTime() - date.getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const STATUS_LABELS: Record<Status, string> = {
  draft: 'Draft',
  pending_manager: 'Waiting for manager',
  pending_finance: 'Waiting for finance',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const ACTION_LABELS: Record<Action, string> = {
  submit: 'Submit for approval',
  approve: 'Approve',
  reject: 'Reject',
  request_changes: 'Request changes',
  cancel: 'Cancel request',
}

/** How a history entry reads in the timeline, e.g. "approved (manager step)". */
export function describeEvent(action: string, from: Status | null, to: Status | null): string {
  switch (action) {
    case 'created':
      return 'created the request'
    case 'edited':
      return 'edited the request'
    case 'file_added':
      return 'attached a file'
    case 'file_removed':
      return 'removed a file'
    case 'submit':
      return from === 'changes_requested' ? 'resubmitted' : 'submitted for approval'
    case 'approve':
      return to === 'approved' ? 'approved: request approved' : 'approved, sent on to finance'
    case 'reject':
      return 'rejected'
    case 'request_changes':
      return 'asked for changes'
    case 'cancel':
      return 'cancelled'
    case 'quote_checked':
      return 'ran the AI quote check'
    default:
      return action
  }
}
