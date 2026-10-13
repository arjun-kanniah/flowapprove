import type { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import { SESSION_COOKIE } from './app.js'
import type { Db } from './db.js'
import type { RequestEvent } from './requests.js'

/**
 * Live updates over Socket.IO. Each browser joins a room for its user and one per role, and a
 * change is sent only to the rooms of the people who can see that request. The message says
 * what changed; the browser then fetches the request through the normal, permission-checked API.
 */
export function attachRealtime(app: FastifyInstance, db: Db) {
  const io = new Server(app.server, { serveClient: false })

  io.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '')
      const raw = cookies[SESSION_COOKIE]
      const unsigned = raw ? app.unsignCookie(raw) : null
      const user =
        unsigned?.valid && unsigned.value
          ? await db.user.findUnique({ where: { id: unsigned.value } })
          : null
      if (!user) return next(new Error('Sign in first.'))
      await socket.join([`user:${user.id}`, ...user.roles.map((role) => `role:${role}`)])
      next()
    } catch (error) {
      next(error as Error)
    }
  })

  function publish(event: RequestEvent) {
    const rooms = [
      ...event.audience.userIds.map((id) => `user:${id}`),
      ...event.audience.roles.map((role) => `role:${role}`),
    ]
    if (rooms.length === 0) return
    io.to(rooms).emit('request.changed', {
      requestId: event.requestId,
      title: event.title,
      status: event.status,
      action: event.action,
      actorId: event.actorId,
      actorName: event.actorName,
    })
  }

  return { io, publish, close: () => io.close() }
}
