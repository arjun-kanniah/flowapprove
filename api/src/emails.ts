import type { Prisma, PurchaseRequest, User } from './generated/prisma/client.js'
import type { Action } from './workflow.js'

/** Where links in emails point: the web app's address. */
export interface MailSettings {
  appUrl: string
}

interface Notice {
  to: Pick<User, 'id' | 'email' | 'name'>
  kind: string
  subject: string
  lines: string[]
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

function body(notice: Notice, request: PurchaseRequest, settings: MailSettings): string {
  const link = `${settings.appUrl.replace(/\/$/, '')}/#/requests/${request.id}`
  return [
    `Hi ${notice.to.name.split(' ')[0]},`,
    '',
    ...notice.lines,
    '',
    `${request.title}`,
    `${request.vendor} · ${money(request.amountCents, request.currency)}`,
    '',
    `Open the request: ${link}`,
    '',
    '— FlowApprove',
  ].join('\n')
}

/**
 * The emails a change should send, written to the outbox inside the change's own transaction.
 * The outbox worker delivers them afterwards, so a decision is never saved without its email,
 * and a slow or failing mail provider never holds up a decision.
 */
export async function queueNotifications(
  tx: Prisma.TransactionClient,
  settings: MailSettings,
  change: {
    request: PurchaseRequest // after the change
    action: Action
    actor: User
    comment: string
    previousStatus: PurchaseRequest['status']
  },
): Promise<number> {
  const { request, action, actor, comment, previousStatus } = change
  const requester = await tx.user.findUniqueOrThrow({ where: { id: request.requesterId } })
  const manager = request.managerId
    ? await tx.user.findUnique({ where: { id: request.managerId } })
    : null
  const said = comment ? [`${actor.name} wrote: “${comment}”`] : []
  const notices: Notice[] = []

  switch (request.status) {
    case 'pending_manager':
      if (action === 'submit' && manager) {
        notices.push({
          to: manager,
          kind: 'approval_needed',
          subject: `Approval needed: ${request.title}`,
          lines: [
            `${requester.name} ${previousStatus === 'changes_requested' ? 'resubmitted' : 'submitted'} a purchase request that needs your approval.`,
          ],
        })
      }
      break
    case 'pending_finance': {
      // Everyone in finance, apart from the people who can't decide this request
      const finance = await tx.user.findMany({
        where: {
          roles: { has: 'finance' },
          id: { notIn: [request.requesterId, request.managerApproverId ?? ''] },
        },
      })
      for (const person of finance) {
        notices.push({
          to: person,
          kind: 'approval_needed',
          subject: `Finance approval needed: ${request.title}`,
          lines: [
            `${actor.name} approved ${requester.name}’s request. Requests of this size also need finance approval.`,
            ...said,
          ],
        })
      }
      break
    }
    case 'approved':
      notices.push({
        to: requester,
        kind: 'approved',
        subject: `Approved: ${request.title}`,
        lines: [`${actor.name} approved your request. You can go ahead with the purchase.`, ...said],
      })
      break
    case 'rejected':
      notices.push({
        to: requester,
        kind: 'rejected',
        subject: `Rejected: ${request.title}`,
        lines: [`${actor.name} rejected your request.`, ...said],
      })
      break
    case 'changes_requested':
      notices.push({
        to: requester,
        kind: 'changes_requested',
        subject: `Changes requested: ${request.title}`,
        lines: [`${actor.name} sent your request back for changes.`, ...said],
      })
      break
    case 'cancelled': {
      // Tell whoever it was waiting on that they no longer need to decide it
      if (previousStatus === 'pending_manager' && manager) {
        notices.push({
          to: manager,
          kind: 'cancelled',
          subject: `Cancelled: ${request.title}`,
          lines: [`${requester.name} cancelled this request. No decision is needed.`],
        })
      }
      break
    }
  }

  if (notices.length === 0) return 0
  await tx.emailMessage.createMany({
    data: notices.map((n) => ({
      toUserId: n.to.id,
      toAddress: n.to.email,
      requestId: request.id,
      kind: n.kind,
      subject: n.subject,
      text: body(n, request, settings),
    })),
  })
  return notices.length
}
