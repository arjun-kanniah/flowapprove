import type { QuoteCheck } from './api'
import { when } from './format'

const VERDICT = {
  match: { label: 'Quote matches the request', className: 'verdict-ok', icon: '✓' },
  mismatch: { label: 'Quote doesn’t match the request', className: 'verdict-bad', icon: '!' },
  unclear: { label: 'Some details couldn’t be confirmed', className: 'verdict-unclear', icon: '?' },
} as const

const FIELD_LABELS = {
  vendor: 'Vendor',
  total: 'Total',
  currency: 'Currency',
  validity: 'Valid until',
  items: 'Items',
} as const

const STATUS_ICON = { ok: '✓', mismatch: '✕', unclear: '?' } as const

type Props = {
  check: QuoteCheck | undefined
  canRun: boolean
  busy: boolean
  onRun: () => void
}

/**
 * The AI quote check: the model reads the quote's facts, and the comparison with the request
 * is done in code, so the verdict follows the numbers.
 */
export function QuoteCheckPanel({ check, canRun, busy, onRun }: Props) {
  const running = busy || check?.status === 'running'
  return (
    <section className="quote-check" aria-live="polite">
      <header className="quote-check-head">
        <h3>
          <span className="ai-tag">AI</span> Quote check
        </h3>
        {canRun && (
          <button type="button" className="ghost-button small-button" onClick={onRun} disabled={running}>
            {running ? 'Checking…' : check ? 'Check again' : 'Check quote'}
          </button>
        )}
      </header>

      {!check && !running && (
        <p className="muted small">
          Compares the quote’s vendor, total, validity date and items with this request.
          {canRun ? ' It also runs by itself when the request is submitted.' : ''}
        </p>
      )}
      {running && <p className="muted small typing">Reading the quote…</p>}
      {check?.status === 'failed' && !running && <p className="notice notice-error">{check.error}</p>}

      {check?.status === 'done' && check.verdict && !running && (
        <>
          <p className={`verdict ${VERDICT[check.verdict].className}`}>
            <span className="verdict-icon" aria-hidden>
              {VERDICT[check.verdict].icon}
            </span>
            {VERDICT[check.verdict].label}
          </p>
          <table className="findings">
            <thead>
              <tr>
                <th>Check</th>
                <th>Request</th>
                <th>Quote</th>
              </tr>
            </thead>
            <tbody>
              {check.findings.map((f) => (
                <tr key={f.field} className={`finding-${f.status}`}>
                  <td>
                    <span className="finding-icon" aria-label={f.status}>
                      {STATUS_ICON[f.status]}
                    </span>{' '}
                    {FIELD_LABELS[f.field]}
                  </td>
                  <td>{f.request}</td>
                  <td>
                    {f.quote}
                    {f.status !== 'ok' && <span className="finding-note">{f.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            {check.filename} · {check.model} · {when(check.createdAt)} · The model reads the quote; totals,
            dates and vendor are compared in code.
          </p>
        </>
      )}
    </section>
  )
}
