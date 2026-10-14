import { useCallback, useEffect, useState } from 'react'
import { api, type Health, type Me, type Role, type Status, type View } from './api'
import { type LiveMessage, useLiveUpdates } from './live'
import { Emails } from './Emails'
import { NewRequest } from './RequestForm'
import { RequestDetail } from './RequestDetail'
import { RequestList } from './RequestList'
import { go, href, useRoute } from './router'
import { LogoMark } from './Logo'
import { SignIn } from './SignIn'
import { ThemeToggle } from './theme'

type Toast = { id: number; text: string; requestId: string }

const OPEN: Status[] = ['draft', 'pending_manager', 'pending_finance', 'changes_requested']

const ROLE_LABELS: Record<Role, string> = {
  requester: 'Requester',
  manager: 'Manager',
  finance: 'Finance',
  admin: 'Admin',
}

const ACTION_WORDS: Record<string, string> = {
  submit: 'submitted',
  approve: 'approved',
  reject: 'rejected',
  request_changes: 'sent back',
  cancel: 'cancelled',
  edited: 'edited',
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [me, setMe] = useState<Me | null | undefined>(undefined) // undefined: still checking
  const [refreshKey, setRefreshKey] = useState(0)
  const [inboxCount, setInboxCount] = useState(0)
  const [openCount, setOpenCount] = useState(0) // the user's requests not yet decided
  const [unreadEmails, setUnreadEmails] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const route = useRoute()

  const loadMe = useCallback(() => {
    // Any failure, a 401 included, shows the sign-in screen
    api.me().then(setMe, () => setMe(null))
  }, [])

  useEffect(() => {
    api.health().then(setHealth, () => setHealth(null))
    loadMe()
  }, [loadMe])

  useEffect(() => {
    if (!me) return
    api.list('inbox').then((r) => setInboxCount(r.length), () => {})
    api.list('mine').then((r) => setOpenCount(r.filter((x) => OPEN.includes(x.status)).length), () => {})
    api.emails().then((r) => setUnreadEmails(r.unread), () => {})
  }, [me, refreshKey])

  const onLive = useCallback(
    (msg: LiveMessage) => {
      setRefreshKey((k) => k + 1)
      if (!me || msg.actorId === me.id) return
      const word = ACTION_WORDS[msg.action]
      if (!word) return
      const toast = {
        id: Date.now() + Math.random(),
        requestId: msg.requestId,
        text: `${msg.actorName} ${word} “${msg.title}”`,
      }
      setToasts((t) => [...t, toast])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 6000)
    },
    [me],
  )
  useLiveUpdates(!!me, onLive)

  async function signOut() {
    await api.signOut()
    setMe(null)
    go(href.list('inbox'))
  }

  if (me === undefined) return null
  if (me === null) {
    return <SignIn demo={health?.demo ?? false} onSignedIn={() => { loadMe(); go(href.list('inbox')) }} />
  }

  const canSeeAll = me.roles.includes('finance') || me.roles.includes('admin')
  const activeView = route.page === 'list' ? route.view : null
  const roleLabel = ROLE_LABELS[me.roles.find((r) => r !== 'requester') ?? 'requester']
  const navLink = (view: View, label: string, count?: number) => (
    <a
      href={href.list(view)}
      className={activeView === view ? 'active' : ''}
      aria-current={activeView === view ? 'page' : undefined}
    >
      <span>{label}</span>
      {!!count && <span className={view === 'inbox' ? 'count' : 'count count-quiet'}>{count}</span>}
    </a>
  )

  return (
    <div className="shell">
      <header className="topbar">
        <a className="topbar-logo" href={href.list('inbox')} aria-label="FlowApprove home">
          <LogoMark size={30} />
          {health?.demo && <span className="demo-pill">Demo · resets nightly</span>}
        </a>
        <span className="topbar-title">FlowApprove</span>
        <div className="who">
          <span className="who-text">
            <strong>{me.name}</strong>
            <span className="muted small">{roleLabel}</span>
          </span>
          <a
            className={`icon-button mail-button ${route.page === 'emails' ? 'active' : ''}`}
            href={href.emails()}
            aria-label={`Email${unreadEmails ? `, ${unreadEmails} unread` : ''}`}
            title="Email"
          >
            ✉{!!unreadEmails && <span className="mail-count">{unreadEmails}</span>}
          </a>
          <ThemeToggle />
          <button
            type="button"
            className="ghost-button switch"
            onClick={() => void signOut()}
            title={health?.auth === 'demo' ? 'Sign in as someone else' : 'Sign out'}
          >
            <span aria-hidden>⇄</span>
            <span className="switch-label">
              {health?.auth === 'demo' ? 'Switch persona' : 'Sign out'}
            </span>
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <a className="button new-request" href={href.new()}>
          + New request
        </a>
        <nav className="nav" aria-label="Requests">
          <p className="nav-group">Approvals</p>
          {navLink('inbox', 'Waiting for me', inboxCount)}
          <p className="nav-group">Requests</p>
          {navLink('mine', 'My requests', openCount)}
          {canSeeAll && navLink('all', 'All requests')}
        </nav>
      </aside>
      <main className="content">
        {route.page === 'list' && <RequestList view={route.view} refreshKey={refreshKey} />}
        {route.page === 'new' && <NewRequest onCreated={(id) => go(href.request(id))} />}
        {route.page === 'request' && <RequestDetail id={route.id} refreshKey={refreshKey} />}
        {route.page === 'emails' && (
          <Emails
            refreshKey={refreshKey}
            sentForReal={health?.email === 'acs'}
            onRead={() => setUnreadEmails((n) => Math.max(0, n - 1))}
          />
        )}
      </main>
      {route.page !== 'new' && (
        <a className="fab" href={href.new()} aria-label="New request">
          +
        </a>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <a key={t.id} className="toast" href={href.request(t.requestId)}>
            {t.text}
          </a>
        ))}
      </div>
    </div>
  )
}
