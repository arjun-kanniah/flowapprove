import { useEffect, useState } from 'react'
import { api, type RequestSummary, type View } from './api'
import { money, when } from './format'
import { href } from './router'
import { StatusBadge } from './StatusBadge'

const TITLES: Record<View, string> = {
  inbox: 'Waiting for me',
  mine: 'My requests',
  all: 'All requests',
}

const EMPTY: Record<View, string> = {
  inbox: 'Nothing is waiting for your approval.',
  mine: 'You haven’t raised any requests yet.',
  all: 'No requests yet.',
}

export function RequestList({ view, refreshKey }: { view: View; refreshKey: number }) {
  const [rows, setRows] = useState<RequestSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    api.list(view).then(
      (r) => current && (setRows(r), setError(null)),
      (e: Error) => current && setError(e.message),
    )
    return () => {
      current = false
    }
  }, [view, refreshKey])

  return (
    <section className="page">
      <header className="page-head">
        <h1>{TITLES[view]}</h1>
        {rows && <span className="muted">{rows.length} {rows.length === 1 ? 'request' : 'requests'}</span>}
      </header>
      {error && <p className="notice notice-error">{error}</p>}
      {rows && rows.length === 0 && <p className="muted empty">{EMPTY[view]}</p>}
      {rows && rows.length > 0 && (
        <table className="requests">
          <thead>
            <tr>
              <th>Request</th>
              {view !== 'mine' && <th>Requester</th>}
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="col-title">
                  <a href={href.request(r.id)}>{r.title}</a>
                  <span className="muted sub">
                    {r.vendor} · {r.category}
                  </span>
                </td>
                {view !== 'mine' && <td className="col-requester">{r.requester.name}</td>}
                <td className="num col-amount">{money(r.amountCents, r.currency)}</td>
                <td className="col-status">
                  <StatusBadge status={r.status} />
                </td>
                <td className="muted col-updated">{when(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
