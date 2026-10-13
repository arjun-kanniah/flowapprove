import { type FormEvent, useState } from 'react'
import { api, type RequestInput } from './api'

export const CATEGORIES = ['Hardware', 'Software', 'Training', 'Travel', 'Furniture', 'Events', 'Services']

type Props = {
  initial?: RequestInput
  submitLabel: string
  onSave: (input: RequestInput) => Promise<void>
  onCancel?: () => void
}

/** The fields of a request, used both to create one and to edit a draft. */
export function RequestForm({ initial, submitLabel, onSave, onCancel }: Props) {
  const [form, setForm] = useState<RequestInput>(
    initial ?? { title: '', description: '', vendor: '', category: 'Hardware', amount: 0 },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<RequestInput>) => setForm((f) => ({ ...f, ...patch }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="request-form" onSubmit={(e) => void submit(e)}>
      <label>
        What do you need?
        <input
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          required
          minLength={3}
          maxLength={120}
          placeholder="e.g. Two monitors for the review room"
        />
      </label>
      <div className="row">
        <label>
          Vendor
          <input
            value={form.vendor}
            onChange={(e) => set({ vendor: e.target.value })}
            required
            minLength={2}
            maxLength={120}
          />
        </label>
        <label>
          Category
          <select value={form.category} onChange={(e) => set({ category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Amount (USD)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount || ''}
            onChange={(e) => set({ amount: Number(e.target.value) })}
            required
          />
        </label>
      </div>
      <label>
        Why it’s needed
        <textarea
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={4}
          maxLength={4000}
        />
      </label>
      {error && <p className="notice notice-error">{error}</p>}
      <div className="actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export function NewRequest({ onCreated }: { onCreated: (id: string) => void }) {
  return (
    <section className="page narrow">
      <header className="page-head">
        <h1>New request</h1>
      </header>
      <p className="muted">
        It’s saved as a draft. Attach the vendor’s quote, then submit it for approval.
      </p>
      <RequestForm
        submitLabel="Save draft"
        onSave={async (input) => {
          const created = await api.create(input)
          onCreated(created.id)
        }}
        onCancel={() => window.history.back()}
      />
    </section>
  )
}
