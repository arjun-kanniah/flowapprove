import { useCallback, useEffect, useState } from 'react'
import { api, type Health, type Me, type View } from './api'
import { type LiveMessage, useLiveUpdates } from './live'
import { NewRequest } from './RequestForm'
import { RequestDetail } from './RequestDetail'
import { RequestList } from './RequestList'
import { go, href, useRoute } from './router'
import { SignIn } from './SignIn'

type Toast = { id: number; text: string; requestId: string }

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
    if (me) api.list('inbox').then((r) => setInboxCount(r.length), () => {})
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
  const navItems: { view: View; label: string; count?: number }[] = [
    { view: 'inbox', label: 'Waiting for me', count: inboxCount },
    { view: 'mine', label: 'My requests' },
    ...(canSeeAll ? [{ view: 'all' as View, label: 'All requests' }] : []),
  ]
  const activeView = route.page === 'list' ? route.view : null

  return (
    <div className="shell">
      <header className="topbar">
        <a className="logo" href={href.list('inbox')}>
          FlowApprove
        </a>
        {health?.demo && <span className="demo-pill">Public demo · resets nightly</span>}
        <div className="who">
          <span>
            {me.name} <span className="muted">· {me.roles.filter((r) => r !== 'requester').join(', ') || 'requester'}</span>
          </span>
          <button type="button" className="ghost-button" onClick={() => void signOut()}>
            {health?.auth === 'demo' ? 'Switch persona' : 'Sign out'}
          </button>
        </div>
      </header>
      <nav className="nav" aria-label="Requests">
        {navItems.map((item) => (
          <a key={item.view} href={href.list(item.view)} className={activeView === item.view ? 'active' : ''}>
            {item.label}
            {!!item.count && <span className="count">{item.count}</span>}
          </a>
        ))}
        <a href={href.new()} className={route.page === 'new' ? 'active' : ''}>
          + New request
        </a>
      </nav>
      <main className="content">
        {route.page === 'list' && <RequestList view={route.view} refreshKey={refreshKey} />}
        {route.page === 'new' && <NewRequest onCreated={(id) => go(href.request(id))} />}
        {route.page === 'request' && <RequestDetail id={route.id} refreshKey={refreshKey} />}
      </main>
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
