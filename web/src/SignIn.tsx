import { useEffect, useState } from 'react'
import { api, type Persona } from './api'
import { LogoMark } from './Logo'
import { ThemeToggle } from './theme'

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

/** Why a Microsoft sign-in came back without signing in (the API's ?signin= values). */
const SIGN_IN_PROBLEMS: Record<string, string> = {
  cancelled: 'Sign-in with Microsoft was cancelled.',
  expired: 'That sign-in took too long or started in another tab. Try again.',
  failed: 'Sign-in with Microsoft didn’t work. Try again, or pick a persona.',
  taken: 'That email address already belongs to another account here.',
}

/** Take the reason a Microsoft sign-in failed off the address, so a reload doesn't repeat it. */
function signInProblem(): string | null {
  const params = new URLSearchParams(window.location.search)
  const why = params.get('signin')
  if (!why) return null
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  return SIGN_IN_PROBLEMS[why] ?? SIGN_IN_PROBLEMS.failed!
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

/**
 * Sign-in: demo personas, and sign-in with a Microsoft account where it's set up. On the
 * demo both are offered; deployed for a team, it's Microsoft only.
 */
export function SignIn({
  onSignedIn,
  demo,
  personasOn,
  entra,
}: {
  onSignedIn: () => void
  demo: boolean
  personasOn: boolean
  entra: boolean
}) {
  const [personas, setPersonas] = useState<Persona[] | null>(null)
  const [error, setError] = useState<string | null>(signInProblem)

  useEffect(() => {
    if (personasOn) api.personas().then(setPersonas, (e: Error) => setError(e.message))
  }, [personasOn])

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
      <div className="sign-in-head">
        <h1 className="sign-in-title">
          <LogoMark size={40} />
          FlowApprove
        </h1>
        <ThemeToggle />
      </div>
      <p className="lead">
        Purchase requests that go to the right approvers, with live updates and a full audit
        trail.
      </p>
      {error && <p className="notice notice-error">{error}</p>}
      {entra && (
        <section className="entra">
          <a className="microsoft" href="/api/auth/entra/start">
            <MicrosoftLogo />
            Sign in with Microsoft
          </a>
          {demo && (
            <p className="muted small">
              Any work, school or personal Microsoft account. You join the team as a requester
              reporting to Mo Patel: raise a request, then switch to Mo to approve it. Your name
              and email are kept until the nightly reset.
            </p>
          )}
        </section>
      )}
      {personasOn && <h2>{entra ? 'Or try it as…' : 'Try it as…'}</h2>}
      {personasOn && demo && (
        <p className="muted">
          A public demo with sample data that resets every night. Switch persona any time to see
          the other side of a request.
        </p>
      )}
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
