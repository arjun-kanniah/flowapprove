import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

export type LiveMessage = {
  requestId: string
  title: string
  status: string
  action: string
  actorId: string
  actorName: string
}

/**
 * Live updates for the signed-in user. The server sends only what this user may see; the page
 * then refetches through the normal API. Reconnects on its own after a network drop.
 */
export function useLiveUpdates(enabled: boolean, onMessage: (msg: LiveMessage) => void) {
  const handler = useRef(onMessage)
  handler.current = onMessage

  useEffect(() => {
    if (!enabled) return
    const socket = io({ transports: ['websocket'], withCredentials: true })
    socket.on('request.changed', (msg: LiveMessage) => handler.current(msg))
    return () => {
      socket.close()
    }
  }, [enabled])
}
