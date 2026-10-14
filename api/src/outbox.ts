import type { Db } from './db.js'
import type { Mailer } from './mailer.js'

export const MAX_ATTEMPTS = 5

/** Wait before retry n (1-based): 30 s, 2 min, 8 min, 32 min. */
export function backoffMs(attempt: number): number {
  return 30_000 * 4 ** (attempt - 1)
}

/**
 * Deliver pending emails once. Rows are claimed with FOR UPDATE SKIP LOCKED, so several
 * instances can run this at the same time without sending anything twice.
 */
export async function deliverPending(db: Db, mailer: Mailer, batch = 20, now = new Date()) {
  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM email_messages
      WHERE status = 'pending' AND next_attempt <= ${now}
      ORDER BY created_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED`
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    // Push them back while sending, so a crashed worker's emails are picked up again later
    await tx.emailMessage.updateMany({
      where: { id: { in: ids } },
      data: { nextAttempt: new Date(now.getTime() + 5 * 60_000), attempts: { increment: 1 } },
    })
    return tx.emailMessage.findMany({ where: { id: { in: ids } } })
  })

  let delivered = 0
  for (const email of claimed) {
    try {
      const outcome = await mailer.send({ to: email.toAddress, subject: email.subject, text: email.text })
      await db.emailMessage.update({
        where: { id: email.id },
        data: { status: outcome, sentAt: new Date(), lastError: null },
      })
      delivered++
    } catch (error) {
      const failed = email.attempts >= MAX_ATTEMPTS
      await db.emailMessage.update({
        where: { id: email.id },
        data: {
          status: failed ? 'failed' : 'pending',
          nextAttempt: new Date(now.getTime() + backoffMs(email.attempts)),
          lastError: error instanceof Error ? error.message.slice(0, 500) : String(error),
        },
      })
    }
  }
  return { claimed: claimed.length, delivered }
}

/** Run delivery every few seconds until stopped. */
export function startOutboxWorker(
  db: Db,
  mailer: Mailer,
  onError: (error: unknown) => void,
  everyMs = 5000,
) {
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    deliverPending(db, mailer)
      .catch(onError)
      .finally(() => {
        running = false
      })
  }, everyMs)
  return () => clearInterval(timer)
}
