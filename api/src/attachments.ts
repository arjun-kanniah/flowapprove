import { createHash, randomUUID } from 'node:crypto'
import type { Db } from './db.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'
import type { Attachment, User } from './generated/prisma/client.js'
import { canView, type Publish } from './requests.js'
import type { Storage } from './storage.js'

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS = 5

/** PDFs only, recognised by their first bytes rather than by the name or the browser's word. */
export function isPdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString('latin1') === '%PDF-'
}

function editable(status: string) {
  return status === 'draft' || status === 'changes_requested'
}

export async function addAttachment(
  db: Db,
  storage: Storage,
  user: User,
  requestId: string,
  file: { filename: string; data: Buffer },
  publish: Publish,
): Promise<Attachment> {
  const request = await db.purchaseRequest.findUnique({
    where: { id: requestId },
    include: { _count: { select: { attachments: true } } },
  })
  if (!request || !canView(request, user)) throw notFound('Request not found')
  if (request.requesterId !== user.id) throw forbidden('Only the requester can add files.')
  if (!editable(request.status)) {
    throw conflict('Files can be added to a draft or a request sent back for changes.')
  }
  if (request._count.attachments >= MAX_ATTACHMENTS) {
    throw badRequest(`A request can have up to ${MAX_ATTACHMENTS} files.`)
  }
  if (!isPdf(file.data)) throw badRequest('Only PDF files can be attached.')

  const id = randomUUID()
  const storageKey = `${requestId}/${id}.pdf`
  await storage.put(storageKey, file.data, 'application/pdf')
  const filename = file.filename.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'quote.pdf'
  const attachment = await db.$transaction(async (tx) => {
    const created = await tx.attachment.create({
      data: {
        id,
        requestId,
        filename,
        contentType: 'application/pdf',
        sizeBytes: file.data.length,
        sha256: createHash('sha256').update(file.data).digest('hex'),
        storageKey,
        uploadedById: user.id,
      },
    })
    await tx.auditEvent.create({
      data: { requestId, actorId: user.id, action: 'file_added', details: { filename } },
    })
    return created
  })
  publish({
    requestId,
    title: request.title,
    status: request.status,
    action: 'file_added',
    actorId: user.id,
    actorName: user.name,
    audience: { userIds: [user.id], roles: [] },
  })
  return attachment
}

export async function removeAttachment(
  db: Db,
  storage: Storage,
  user: User,
  attachmentId: string,
  publish: Publish,
): Promise<void> {
  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    include: { request: true },
  })
  if (!attachment || !canView(attachment.request, user)) throw notFound('File not found')
  if (attachment.request.requesterId !== user.id) {
    throw forbidden('Only the requester can remove files.')
  }
  if (!editable(attachment.request.status)) {
    throw conflict('Files can be removed from a draft or a request sent back for changes.')
  }
  await db.$transaction([
    db.attachment.delete({ where: { id: attachmentId } }),
    db.auditEvent.create({
      data: {
        requestId: attachment.requestId,
        actorId: user.id,
        action: 'file_removed',
        details: { filename: attachment.filename },
      },
    }),
  ])
  await storage.delete(attachment.storageKey)
  publish({
    requestId: attachment.requestId,
    title: attachment.request.title,
    status: attachment.request.status,
    action: 'file_removed',
    actorId: user.id,
    actorName: user.name,
    audience: { userIds: [user.id], roles: [] },
  })
}

/** A file and its name, if the user may see the request it belongs to. */
export async function readAttachment(
  db: Db,
  storage: Storage,
  user: User,
  attachmentId: string,
): Promise<{ attachment: Attachment; data: Buffer }> {
  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    include: { request: true },
  })
  if (!attachment || !canView(attachment.request, user)) throw notFound('File not found')
  return { attachment, data: await storage.get(attachment.storageKey) }
}
