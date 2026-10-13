export type Role = 'requester' | 'manager' | 'finance' | 'admin'
export type Status =
  | 'draft'
  | 'pending_manager'
  | 'pending_finance'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'cancelled'
export type Action = 'submit' | 'approve' | 'reject' | 'request_changes' | 'cancel'
export type View = 'inbox' | 'mine' | 'all'

export type Person = { id: string; name: string }

export type Me = { id: string; name: string; email: string; roles: Role[]; manager: Person | null }
export type Persona = Me
export type Health = { status: string; version: string; demo: boolean; auth: 'demo' | 'entra' }

export type RequestSummary = {
  id: string
  title: string
  vendor: string
  category: string
  amountCents: number
  currency: string
  status: Status
  requester: Person
  updatedAt: string
}

export type Attachment = {
  id: string
  filename: string
  sizeBytes: number
  createdAt: string
}

export type HistoryEntry = {
  action: string
  actor: Person | null
  fromStatus: Status | null
  toStatus: Status | null
  details: { comment?: string; filename?: string; changed?: Record<string, { from: unknown; to: unknown }> }
  createdAt: string
}

export type RequestDetail = RequestSummary & {
  description: string
  manager: Person | null
  submittedAt: string | null
  closedAt: string | null
  createdAt: string
  attachments: Attachment[]
  history: HistoryEntry[]
  actions: Action[]
  canEdit: boolean
  waitingOn: 'manager' | 'finance' | null
}

export type RequestInput = {
  title: string
  description: string
  vendor: string
  category: string
  amount: number
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new ApiError(res.status, body?.detail ?? `HTTP ${res.status}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  health: () => call<Health>('/api/health'),
  me: () => call<Me>('/api/me'),
  personas: () => call<Persona[]>('/api/auth/personas'),
  signInAs: (userId: string) => call<Person>('/api/auth/demo', json('POST', { userId })),
  signOut: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  list: (view: View) => call<RequestSummary[]>(`/api/requests?view=${view}`),
  get: (id: string) => call<RequestDetail>(`/api/requests/${id}`),
  create: (input: RequestInput) => call<RequestSummary>('/api/requests', json('POST', input)),
  update: (id: string, input: Partial<RequestInput>) =>
    call<RequestSummary>(`/api/requests/${id}`, json('PATCH', input)),
  act: (id: string, action: Action, comment = '') =>
    call<RequestSummary>(`/api/requests/${id}/actions`, json('POST', { action, comment })),
  upload: (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return call<Attachment>(`/api/requests/${id}/attachments`, { method: 'POST', body: form })
  },
  removeAttachment: (id: string) => call<void>(`/api/attachments/${id}`, { method: 'DELETE' }),
}
