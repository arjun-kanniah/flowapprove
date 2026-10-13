import type { Db } from './db.js'

/**
 * Delete all data: for tests and the public demo's nightly reset. The audit log refuses
 * changes through a trigger, so this switches the trigger off inside the same transaction
 * (allowed for the table owner) and the log stays append-only for everything else.
 */
export async function resetData(db: Db): Promise<void> {
  await db.$transaction([
    db.$executeRawUnsafe('ALTER TABLE audit_events DISABLE TRIGGER USER'),
    db.$executeRawUnsafe(
      'TRUNCATE audit_events, ai_checks, decisions, attachments, purchase_requests, users ' +
        'RESTART IDENTITY CASCADE',
    ),
    db.$executeRawUnsafe('ALTER TABLE audit_events ENABLE TRIGGER USER'),
  ])
}
