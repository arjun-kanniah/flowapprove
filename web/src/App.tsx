import { useEffect, useState } from 'react'

type Health = { status: string; version: string; demo: boolean }

/** Placeholder shell: confirms the web app reaches the API. The real screens come next. */
export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>FlowApprove</h1>
      <p>
        {health ? `API ${health.version}: ${health.status}` : error ? `API: ${error}` : 'Connecting…'}
      </p>
    </main>
  )
}
