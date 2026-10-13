import { useEffect, useState } from 'react'
import { api, type Persona } from './api'

const ROLE_HINTS: Record<string, string> = {
  manager: 'approves their team’s requests',
  finance: 'approves requests of $1,000 or more',
  admin: 'sees every request',
}

function describe(p: Persona): string {
  const extra = p.roles.filter((r) => r !== 'requester').map((r) => ROLE_HINTS[r])
  const reports = p.manager ? `Reports to ${p.manager.name}.` : 'Heads the team.'
  return [reports, ...extra.map((e) => `${e.charAt(0).toUpperCase()}${e.slice(1)}.`)].join(' ')
}

/** Demo sign-in: pick a persona. Deployed for a team, this is Entra ID sign-in instead. */
export function SignIn({ onSignedIn, demo }: { onSignedIn: () => void; demo: boolean }) {
  const [personas, setPersonas] = useState<Persona[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.personas().then(setPersonas, (e: Error) => setError(e.message))
  }, [])

  async function choose(id: string) {
    try {
      await api.signInAs(id)
      onSignedIn()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <main className="sign-in">
      <h1>FlowApprove</h1>
      <p className="lead">
        Purchase requests that go to the right approvers, with live updates and a full audit
        trail.
      </p>
      <h2>Try it as…</h2>
      {demo && (
        <p className="muted">
          A public demo with sample data that resets every night. Switch persona any time to see
          the other side of a request.
        </p>
      )}
      {error && <p className="notice notice-error">{error}</p>}
      <ul className="personas">
        {personas?.map((p) => (
          <li key={p.id}>
            <button type="button" className="persona" onClick={() => void choose(p.id)}>
              <span className="avatar" aria-hidden>
                {p.name.charAt(0)}
              </span>
              <span>
                <strong>{p.name}</strong>
                <span className="muted">{describe(p)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
