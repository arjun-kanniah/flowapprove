import { useEffect, useState } from 'react'
import type { View } from './api'

export type Route =
  | { page: 'list'; view: View }
  | { page: 'new' }
  | { page: 'request'; id: string }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  const [first, second] = path.split('/')
  if (first === 'new') return { page: 'new' }
  if (first === 'requests' && second) return { page: 'request', id: second }
  if (first === 'mine' || first === 'all') return { page: 'list', view: first }
  return { page: 'list', view: 'inbox' }
}

export const href = {
  list: (view: View) => `#/${view}`,
  new: () => '#/new',
  request: (id: string) => `#/requests/${id}`,
}

/** The current page, from the URL hash, so the back button and links work without a library. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}

export function go(to: string) {
  window.location.hash = to
}
