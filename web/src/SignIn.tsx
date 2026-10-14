import { useEffect, useState } from 'react'
import { api, type Persona } from './api'
import { LogoMark } from './Logo'
import { ThemeToggle } from './theme'

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

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  finance: 'Finance',
  admin: 'Admin',
}

/** A persona's main role, and whose team they're in, in a few words. */
function roleOf(p: Persona): { role: string; detail: string } {
  const role = p.roles.map((r) => ROLE_LABELS[r]).find(Boolean) ?? 'Requester'
  return {
    role,
    detail: p.manager ? `${p.manager.name.split(' ')[0]}’s team` : 'Team head',
  }
}

/** Each persona keeps the same avatar colour. */
const AVATAR_HUES = [250, 280, 190, 330, 160, 30]
function hueFor(name: string): number {
  let sum = 0
  for (const ch of name) sum += ch.charCodeAt(0)
  return AVATAR_HUES[sum % AVATAR_HUES.length]!
}

/** Small line icons for the features, drawn on a 24px grid. */
const ICONS = {
  route:
    'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6',
  check: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 14l2 2 4-4',
  live: 'M3 12h4l3-8 4 16 3-8h4',
}

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  )
}

const FEATURES = [
  {
    icon: ICONS.route,
    title: 'The right approver, every time',
    text: 'Manager first, then finance from $1,000. Nobody approves their own request.',
  },
  {
    icon: ICONS.check,
    title: 'Quotes checked by AI',
    text: 'Totals, dates and vendor compared with the request, in code, not by guesswork.',
  },
  {
    icon: ICONS.live,
    title: 'Live, and on the record',
    text: 'Everyone sees changes as they happen; every action lands in an audit log.',
  },
]

const FLOW = ['Submitted', 'Manager', 'Finance', 'Approved']

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
 * The landing page: what FlowApprove does, and the ways in. On the demo that's a Microsoft
 * account or a persona; deployed for a team, it's Microsoft only.
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
    <div className="landing">
      <header className="landing-bar">
        <span className="landing-brand">
          <LogoMark size={28} />
          FlowApprove
        </span>
        <ThemeToggle />
      </header>

      <main className="landing-main">
        <section className="pitch">
          {demo && <span className="landing-badge">Live demo · sample data, reset nightly</span>}
          <h1>Purchase approvals, without the chasing.</h1>
          <p className="pitch-lead">
            Requests go to the right people in the right order, quotes get checked, and everyone
            sees where things stand.
          </p>
          <ol className="flow" aria-label="How a request moves">
            {FLOW.map((step) => (
              <li key={step}>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <ul className="features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className="feature-icon">
                  <Icon path={f.icon} />
                </span>
                <span>
                  <strong>{f.title}</strong>
                  <span className="muted">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="entry" aria-label="Sign in">
          <h2>{demo ? 'Try it' : 'Sign in'}</h2>
          {error && <p className="notice notice-error">{error}</p>}
          {entra && (
            <>
              <a className="microsoft" href="/api/auth/entra/start">
                <MicrosoftLogo />
                Sign in with Microsoft
              </a>
              {demo && (
                <p className="muted small entry-note">
                  Work, school or personal account. You join as a requester reporting to Mo; your
                  name and email are kept until the nightly reset.
                </p>
              )}
            </>
          )}
          {personasOn && (
            <>
              {entra && <p className="divider">or pick a persona</p>}
              <ul className="personas">
                {personas?.map((p) => {
                  const { role, detail } = roleOf(p)
                  return (
                    <li key={p.id}>
                      <button type="button" className="persona" onClick={() => void choose(p.id)}>
                        <span
                          className="avatar"
                          style={{ '--hue': hueFor(p.name) } as React.CSSProperties}
                          aria-hidden
                        >
                          {p.name.charAt(0)}
                        </span>
                        <span className="persona-text">
                          <strong>{p.name}</strong>
                          <span className="muted small">
                            <span className="role">{role}</span> · {detail}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {demo && (
                <p className="muted small entry-note">
                  Tip: sign in as Rita in one window and Mo in another, and watch a request move
                  between them live.
                </p>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="landing-foot muted small">
        <a href="https://github.com/arjun-kanniah/flowapprove">Source on GitHub</a>
        <span aria-hidden>·</span>
        <span>React, Fastify, PostgreSQL on Azure</span>
      </footer>
    </div>
  )
}
