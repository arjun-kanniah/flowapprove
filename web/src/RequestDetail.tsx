import { useCallback, useEffect, useRef, useState } from 'react'
import { type Action, api, type RequestDetail as Detail } from './api'
import { ACTION_LABELS, describeEvent, money, when } from './format'
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

function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function RequestDetail({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [request, setRequest] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
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
    return <section className="page">{error ? <p className="notice notice-error">{error}</p> : <p className="muted">Loading…</p>}</section>
  }

  const deciding = request.actions.some((a) => a === 'approve' || a === 'reject')
  const waitingOn =
    request.waitingOn === 'manager'
      ? `Waiting for ${request.manager?.name ?? 'the manager'}`
      : request.waitingOn === 'finance'
        ? 'Waiting for finance'
        : null

  return (
    <section className="page narrow">
      <a className="back" href="#/" onClick={(e) => { e.preventDefault(); window.history.back() }}>
        ← Back
      </a>
      <header className="detail-head">
        <div>
          <h1>{request.title}</h1>
          <p className="muted">
            {request.vendor} · {request.category} · requested by {request.requester.name}
          </p>
        </div>
        <div className="amount">
          <strong>{money(request.amountCents, request.currency)}</strong>
          <StatusBadge status={request.status} />
          {waitingOn && <span className="muted small">{waitingOn}</span>}
        </div>
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
          {request.description && <p className="description">{request.description}</p>}
          {request.canEdit && (
            <button type="button" className="ghost-button" onClick={() => setEditing(true)}>
              Edit details
            </button>
          )}
        </>
      )}

      <h2 className="section">Quote</h2>
      {request.attachments.length === 0 ? (
        <p className="muted">No files attached{request.canEdit ? ' yet: attach the vendor’s quote as a PDF.' : '.'}</p>
      ) : (
        <ul className="files">
          {request.attachments.map((file) => (
            <li key={file.id}>
              <a href={`/api/attachments/${file.id}`} target="_blank" rel="noreferrer">
                {file.filename}
              </a>
              <span className="muted"> · {formatBytes(file.sizeBytes)}</span>
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
          <button type="button" className="ghost-button" onClick={() => fileInput.current?.click()} disabled={busy}>
            Attach PDF
          </button>
        </>
      )}

      {request.actions.length > 0 && (
        <div className="decide">
          {(deciding || request.actions.includes('request_changes')) && (
            <label>
              Comment {deciding && <span className="muted">(needed to reject or request changes)</span>}
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} />
            </label>
          )}
          <div className="actions">
            {request.actions.map((action) => (
              <button
                key={action}
                type="button"
                className={BUTTON_CLASS[action]}
                disabled={busy}
                onClick={() => void act(action)}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="notice notice-error">{error}</p>}

      <h2 className="section">History</h2>
      <ol className="timeline">
        {request.history.map((entry, i) => (
          <li key={i}>
            <span className="when muted">{when(entry.createdAt)}</span>
            <span>
              <strong>{entry.actor?.name ?? 'System'}</strong>{' '}
              {describeEvent(entry.action, entry.fromStatus, entry.toStatus)}
              {entry.details.filename && <span className="muted"> ({entry.details.filename})</span>}
              {entry.details.changed && (
                <span className="muted"> ({Object.keys(entry.details.changed).join(', ')})</span>
              )}
              {entry.details.comment && <q className="comment">{entry.details.comment}</q>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
