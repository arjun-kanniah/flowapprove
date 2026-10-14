import { useEffect, useState } from 'react'
import { api, type Email } from './api'
import { when } from './format'
import { href } from './router'

const KIND_LABELS: Record<string, string> = {
  approval_needed: 'Needs you',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Sent back',
  cancelled: 'Cancelled',
}

/**
 * The emails this person was sent. On the demo, where the people and addresses are made up,
 * this is how notifications can be seen; deployed for a team, they also arrive by email.
 */
export function Emails({
  refreshKey,
  sentForReal,
  onRead,
}: {
  refreshKey: number
  sentForReal: boolean
  onRead: () => void
}) {
  const [emails, setEmails] = useState<Email[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    api.emails().then((r) => setEmails(r.emails), () => setEmails([]))
  }, [refreshKey])

  async function toggle(email: Email) {
    setOpen((current) => (current === email.id ? null : email.id))
    if (!email.readAt) {
      await api.markRead(email.id)
      setEmails((all) => all?.map((e) => (e.id === email.id ? { ...e, readAt: new Date().toISOString() } : e)) ?? null)
      onRead()
    }
  }

  return (
    <section className="page narrow">
      <header className="page-head">
        <h1>Email</h1>
      </header>
      <p className="muted">
        {sentForReal
          ? 'The notifications FlowApprove has emailed you.'
          : 'Emails aren’t sent from here, since the demo’s people and addresses are made up. These are the notifications FlowApprove would have emailed you.'}
      </p>
      {emails && emails.length === 0 && <p className="muted empty">No emails yet.</p>}
      <ul className="emails">
        {emails?.map((email) => (
          <li key={email.id} className={`email card ${email.readAt ? '' : 'unread'}`}>
            <button type="button" className="email-head" onClick={() => void toggle(email)} aria-expanded={open === email.id}>
              <span className={`email-kind kind-${email.kind}`}>{KIND_LABELS[email.kind] ?? email.kind}</span>
              <span className="email-subject">{email.subject}</span>
              <span className="muted small">{when(email.createdAt)}</span>
            </button>
            {open === email.id && (
              <div className="email-body">
                <pre>{email.text.replace(/\n\nOpen the request: .*\n/, '')}</pre>
                {email.requestId && (
                  <a className="button small-button" href={href.request(email.requestId)}>
                    Open the request
                  </a>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
