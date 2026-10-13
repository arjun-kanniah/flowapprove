import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addAttachment } from './attachments.js'
import type { Db } from './db.js'
import type { Role, User } from './generated/prisma/client.js'
import { act, createRequest } from './requests.js'
import { resetData } from './reset.js'
import type { Storage } from './storage.js'
import type { Action, Policy } from './workflow.js'

/** The demo's people. Everyone can raise requests; the roles add what else they can do. */
const PERSONAS: { key: string; name: string; email: string; roles: Role[]; manager?: string }[] = [
  { key: 'dana', name: 'Dana Lee', email: 'dana@example.com', roles: ['requester', 'manager'] },
  { key: 'mo', name: 'Mo Patel', email: 'mo@example.com', roles: ['requester', 'manager'], manager: 'dana' },
  { key: 'rita', name: 'Rita Chen', email: 'rita@example.com', roles: ['requester'], manager: 'mo' },
  { key: 'sam', name: 'Sam Ortiz', email: 'sam@example.com', roles: ['requester'], manager: 'mo' },
  { key: 'fay', name: 'Fay Nguyen', email: 'fay@example.com', roles: ['requester', 'finance'], manager: 'dana' },
  { key: 'ada', name: 'Ada Brooks', email: 'ada@example.com', roles: ['requester', 'admin'], manager: 'dana' },
]

type Step = [who: string, action: Action, comment?: string]

/** Requests in every state, each reached through the real rules, so the history is real too. */
const REQUESTS: {
  by: string
  title: string
  vendor: string
  category: string
  amount: number
  description: string
  /** A file in demo/quotes, attached before the steps run. */
  quote?: string
  steps: Step[]
}[] = [
  {
    by: 'rita',
    title: 'Monitors for the design review room',
    vendor: 'Northwind Displays',
    category: 'Hardware',
    amount: 840,
    description: 'Two 27-inch monitors so reviews can show designs side by side.',
    quote: 'northwind_displays_quote.pdf',
    steps: [['rita', 'submit']],
  },
  {
    by: 'sam',
    title: 'Design tool seats, annual plan',
    vendor: 'Canvasly',
    category: 'Software',
    amount: 2400,
    description: 'Eight seats for the product design team, billed yearly.',
    quote: 'canvasly_quote.pdf',
    steps: [['sam', 'submit'], ['mo', 'approve', 'Needed for the Q1 redesign.']],
  },
  {
    by: 'rita',
    title: 'Conference ticket and travel',
    vendor: 'CloudConf 2026',
    category: 'Training',
    amount: 1150,
    description: 'Ticket plus two nights for the platform engineering track.',
    quote: 'cloudconf_2026_quote.pdf',
    steps: [
      ['rita', 'submit'],
      ['mo', 'approve'],
      ['fay', 'approve', 'Within the training budget.'],
    ],
  },
  {
    by: 'sam',
    title: 'Standing desk',
    vendor: 'Ergo Works',
    category: 'Furniture',
    amount: 650,
    description: 'Height-adjustable desk.',
    steps: [['sam', 'submit'], ['mo', 'request_changes', 'Please attach the vendor quote.']],
  },
  {
    by: 'mo',
    title: 'Team offsite catering',
    vendor: 'Harvest Table Catering',
    category: 'Events',
    amount: 3200,
    description: 'Lunch and dinner for 14 people over two days.',
    quote: 'harvest_table_catering_quote.pdf',
    steps: [['mo', 'submit']],
  },
  {
    by: 'fay',
    title: 'Accounting software add-on',
    vendor: 'LedgerPro',
    category: 'Software',
    amount: 5000,
    description: 'Multi-entity consolidation module.',
    quote: 'ledgerpro_quote.pdf',
    steps: [['fay', 'submit'], ['dana', 'reject', 'Not this year; revisit in Q2 planning.']],
  },
  {
    by: 'rita',
    title: 'Mechanical keyboard',
    vendor: 'KeyCraft',
    category: 'Hardware',
    amount: 180,
    description: '',
    steps: [],
  },
]

/** The sample quotes in the repo's demo/quotes folder, unless DEMO_QUOTES_DIR says otherwise. */
export const QUOTES_DIR =
  process.env.DEMO_QUOTES_DIR ?? fileURLToPath(new URL('../../demo/quotes/', import.meta.url))

/** Replace all data with the demo personas and requests. Returns the personas by key. */
export async function seedDemo(
  db: Db,
  policy: Policy,
  storage: Storage,
): Promise<Record<string, User>> {
  const oldFiles = await db.attachment.findMany({ select: { storageKey: true } })
  await resetData(db)
  await Promise.all(oldFiles.map((f) => storage.delete(f.storageKey)))
  const users: Record<string, User> = {}
  for (const p of PERSONAS) {
    users[p.key] = await db.user.create({
      data: {
        name: p.name,
        email: p.email,
        roles: p.roles,
        isDemo: true,
        managerId: p.manager ? users[p.manager]?.id : null,
      },
    })
  }

  const quiet = () => {}
  for (const r of REQUESTS) {
    const requester = users[r.by]!
    const created = await createRequest(
      db,
      requester,
      {
        title: r.title,
        vendor: r.vendor,
        category: r.category,
        description: r.description,
        amountCents: r.amount * 100,
      },
      quiet,
    )
    if (r.quote) {
      const data = await readFile(join(QUOTES_DIR, r.quote))
      await addAttachment(db, storage, requester, created.id, { filename: r.quote, data }, quiet)
    }
    for (const [who, action, comment = ''] of r.steps) {
      await act(db, users[who]!, created.id, action, comment, policy, quiet)
    }
  }
  return users
}
