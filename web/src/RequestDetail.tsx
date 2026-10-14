import { useCallback, useEffect, useRef, useState } from 'react'
import { type Action, api, type RequestDetail as Detail } from './api'
import { ACTION_LABELS, describeEvent, money, when } from './format'
import { type ProgressStep, progress } from './progress'
import { QuoteCheckPanel } from './QuoteCheckPanel'
import { RequestForm } from './RequestForm'
import { StatusBadge } from './StatusBadge'

const NEEDS_COMMENT: Action[] = ['reject', 'request_changes']
const BUTTON_CLASS: Record<Action, string> = {
  submit: 'button',
  approve: 'button button-ok',
  reject: 'button button-danger',
  request_changes: 'ghost-button',
  cancel: 'ghost-button',
}
const HISTORY_PREVIEW = 4
const VERDICT_WORDS = { match: 'matches', mismatch: 'doesn’t match', unclear: 'unclear' }

const STEP_NOTES: Record<ProgressStep['state'], string> = {
  done: 'Done',
  current: 'In progress',
  upcoming: 'Next',
  rejected: 'Rejected',
  returned: 'Sent back',
  stopped: 'Stopped',
}

const DECISION_WORDS = { approve: 'Approved', reject: 'Rejected', request_changes: 'Sent back' }

function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Tracker({ request }: { request: Detail }) {
  return (
    <ol className="tracker" aria-label="Approval progress">
      {progress(request).map((step) => (
        <li key={step.key} className={`step step-${step.state}`}>
          <span className="dot" aria-hidden>
            {step.state === 'done' ? '✓' : step.state === 'rejected' ? '✕' : step.state === 'returned' ? '↩' : ''}
          </span>
          <span className="step-text">
            <strong>{step.label}</strong>
            <span className="muted small">
              {STEP_NOTES[step.state]}
              {step.who && step.key !== 'approved' ? ` · ${step.who}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function RequestDetail({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [request, setRequest] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [allHistory, setAllHistory] = useState(false)
  const [checking, setChecking] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api.get(id).then(
      (r) => {
        setRequest(r)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [id])

  useEffect(load, [load, refreshKey])

  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await task()
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function act(action: Action) {
    if (NEEDS_COMMENT.includes(action) && !comment.trim()) {
      setError('Add a comment so the requester knows why.')
      return
    }
    if (action === 'cancel' && !window.confirm('Cancel this request? This can’t be undone.')) return
    await run(async () => {
      await api.act(id, action, comment)
      setComment('')
    })
  }

  if (!request) {
    return (
      <section className="page">
        {error ? <p className="notice notice-error">{error}</p> : <p className="muted">Loading…</p>}
      </section>
    )
  }

  const deciding = request.actions.some((a) => a === 'approve' || a === 'reject')
  const ownActions = request.actions.filter((a) => a === 'submit' || a === 'cancel')
  const history = [...request.history].reverse() // newest first
  const shownHistory = allHistory ? history : history.slice(0, HISTORY_PREVIEW)

  return (
    <section className="page detail">
      <a
        className="back"
        href="#/"
        onClick={(e) => {
          e.preventDefault()
          window.history.back()
        }}
      >
        ← Back
      </a>

      <article className="card hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">{request.category}</p>
            <h1>{request.title}</h1>
            <p className="muted">
              {request.vendor} · requested by {request.requester.name} · {when(request.createdAt)}
            </p>
          </div>
          <div className="amount">
            <strong>{money(request.amountCents, request.currency)}</strong>
            <StatusBadge status={request.status} />
          </div>
        </div>
        <Tracker request={request} />
      </article>

      {deciding && (
        <article className="card card-accent">
          <h2>Your decision</h2>
          <p className="muted small">
            {request.waitingOn === 'finance'
              ? `Finance approval is needed for requests of ${money(request.financeThresholdCents)} or more.`
              : `${request.requester.name} reports to you.`}{' '}
            A comment is needed to reject or send back.
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Add a comment for the requester"
            aria-label="Comment"
          />
          <div className="actions">
            {request.actions
              .filter((a) => a !== 'submit' && a !== 'cancel')
              .map((action) => (
                <button key={action} type="button" className={BUTTON_CLASS[action]} disabled={busy} onClick={() => void act(action)}>
                  {ACTION_LABELS[action]}
                </button>
              ))}
          </div>
          {error && <p className="notice notice-error">{error}</p>}
        </article>
      )}

      <div className="columns">
        <div className="main-col">
          <article className="card">
            <header className="card-head">
              <h2>Details</h2>
              {request.canEdit && !editing && (
                <button type="button" className="ghost-button small-button" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </header>
            {editing ? (
              <RequestForm
                initial={{
                  title: request.title,
                  description: request.description,
                  vendor: request.vendor,
                  category: request.category,
                  amount: request.amountCents / 100,
                }}
                submitLabel="Save changes"
                onSave={async (input) => {
                  await api.update(id, input)
                  setEditing(false)
                  load()
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <>
                <dl className="facts">
                  <div>
                    <dt>Vendor</dt>
                    <dd>{request.vendor}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{request.category}</dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd>{money(request.amountCents, request.currency)}</dd>
                  </div>
                  <div>
                    <dt>Approver</dt>
                    <dd>
                      {request.manager?.name ?? 'No manager assigned'}
                      {request.financeRequired && ', then finance'}
                    </dd>
                  </div>
                </dl>
                <h3 className="sub-head">Why it’s needed</h3>
                <p className="description">{request.description || <span className="muted">No description.</span>}</p>
              </>
            )}
          </article>

          <article className="card">
            <header className="card-head">
              <h2>Quote</h2>
              {request.canEdit && (
                <>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void run(() => api.upload(id, file))
                    }}
                  />
                  <button
                    type="button"
                    className="ghost-button small-button"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    Attach PDF
                  </button>
                </>
              )}
            </header>
            {request.attachments.length === 0 ? (
              <p className="muted">
                No quote attached{request.canEdit ? ' yet. Attach the vendor’s quote as a PDF.' : '.'}
              </p>
            ) : (
              <ul className="file-list">
                {request.attachments.map((file) => (
                  <li key={file.id}>
                    <span className="file-icon" aria-hidden>
                      PDF
                    </span>
                    <a href={`/api/attachments/${file.id}`} target="_blank" rel="noreferrer">
                      {file.filename}
                    </a>
                    <span className="muted small">{formatBytes(file.sizeBytes)}</span>
                    {request.canEdit && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void run(() => api.removeAttachment(file.id))}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {request.quoteCheckAvailable && request.attachments.length > 0 && (
              <QuoteCheckPanel
                check={request.quoteChecks[0]}
                canRun={request.canEdit || deciding}
                busy={checking}
                onRun={() => {
                  setChecking(true)
                  void run(() => api.checkQuote(id)).finally(() => setChecking(false))
                }}
              />
            )}
          </article>

          {ownActions.length > 0 && (
            <article className="card">
              <h2>{request.status === 'pending_manager' || request.status === 'pending_finance' ? 'Your request' : 'Ready to send?'}</h2>
              <p className="muted small">
                {ownActions.includes('submit')
                  ? `It goes to ${request.manager?.name ?? 'your manager'} first${request.financeRequired ? ', then to finance' : ''}.`
                  : 'You can cancel it until it’s decided.'}
              </p>
              <div className="actions">
                {ownActions.map((action) => (
                  <button key={action} type="button" className={BUTTON_CLASS[action]} disabled={busy} onClick={() => void act(action)}>
                    {ACTION_LABELS[action]}
                  </button>
                ))}
              </div>
              {!deciding && error && <p className="notice notice-error">{error}</p>}
            </article>
          )}
          {!deciding && ownActions.length === 0 && error && <p className="notice notice-error">{error}</p>}
        </div>

        <aside className="side-col">
          <article className="card">
            <h2>Approval path</h2>
            {request.decisions.length === 0 ? (
              <p className="muted small">No decisions yet.</p>
            ) : (
              <ul className="decisions">
                {request.decisions.map((d, i) => (
                  <li key={i} className={`decision decision-${d.action}`}>
                    <span>
                      <strong>{DECISION_WORDS[d.action]}</strong> by {d.actor.name}
                      <span className="muted small"> · {d.step} step · {when(d.createdAt)}</span>
                    </span>
                    {d.comment && <q className="comment">{d.comment}</q>}
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="card">
            <h2>Key facts</h2>
            <dl className="facts facts-stacked">
              <div>
                <dt>Created</dt>
                <dd>{fullDate(request.createdAt)}</dd>
              </div>
              {request.submittedAt && (
                <div>
                  <dt>Submitted</dt>
                  <dd>{fullDate(request.submittedAt)}</dd>
                </div>
              )}
              {request.closedAt && (
                <div>
                  <dt>Closed</dt>
                  <dd>{fullDate(request.closedAt)}</dd>
                </div>
              )}
              <div>
                <dt>Reference</dt>
                <dd className="mono">{request.id.slice(0, 8).toUpperCase()}</dd>
              </div>
            </dl>
          </article>
        </aside>
      </div>

      <details className="card accordion" open>
        <summary>
          <h2>History</h2>
          <span className="muted small">{history.length} events · every change is recorded and can’t be edited</span>
        </summary>
        <ol className="timeline">
          {shownHistory.map((entry, i) => (
            <li key={i}>
              <span className="when muted small" title={fullDate(entry.createdAt)}>
                {when(entry.createdAt)}
              </span>
              <span>
                <strong>{entry.actor?.name ?? 'System'}</strong>{' '}
                {describeEvent(entry.action, entry.fromStatus, entry.toStatus)}
                {entry.details.filename && <span className="muted"> ({entry.details.filename})</span>}
                {entry.details.verdict && (
                  <span className={`muted verdict-word-${entry.details.verdict}`}>
                    {' '}
                    · {VERDICT_WORDS[entry.details.verdict]}
                  </span>
                )}
                {entry.details.changed && (
                  <span className="muted"> ({Object.keys(entry.details.changed).join(', ')})</span>
                )}
                {entry.details.comment && <q className="comment">{entry.details.comment}</q>}
              </span>
            </li>
          ))}
        </ol>
        {history.length > HISTORY_PREVIEW && (
          <button type="button" className="link-button show-all" onClick={() => setAllHistory((v) => !v)}>
            {allHistory ? 'Show recent only' : `Show all ${history.length} events`}
          </button>
        )}
      </details>
    </section>
  )
}
