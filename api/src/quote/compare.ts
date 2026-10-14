import type { QuoteExtraction } from './schema.js'

export type CheckStatus = 'ok' | 'mismatch' | 'unclear'
export type Verdict = 'match' | 'mismatch' | 'unclear'

export interface Finding {
  field: 'vendor' | 'total' | 'currency' | 'validity' | 'items'
  status: CheckStatus
  /** What the request says, and what the quote says, for the side-by-side view. */
  request: string
  quote: string
  note: string
}

export interface RequestFacts {
  vendor: string
  amountCents: number
  currency: string
  title: string
  description: string
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

/** "Contoso Supplies, Inc." and "contoso supplies" are the same vendor. */
export function sameVendor(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,&']/g, ' ')
      .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const [x, y] = [norm(a), norm(b)]
  return x.length > 0 && (x === y || x.includes(y) || y.includes(x))
}

/**
 * Compare what the model read off the quote with the request. The verdict comes from these
 * checks, so a model can't call a quote a match when the numbers say otherwise.
 */
export function compareQuote(
  request: RequestFacts,
  quote: QuoteExtraction,
  today: Date,
): { verdict: Verdict; findings: Finding[] } {
  if (!quote.readable) {
    return {
      verdict: 'unclear',
      findings: [
        {
          field: 'items',
          status: 'unclear',
          request: request.title,
          quote: '(no readable quote)',
          note: 'The file has no readable quote text. A scanned PDF needs checking by eye.',
        },
      ],
    }
  }

  const findings: Finding[] = []

  findings.push(
    quote.vendor === null
      ? { field: 'vendor', status: 'unclear', request: request.vendor, quote: '(not found)', note: 'The quote doesn’t name a vendor.' }
      : sameVendor(request.vendor, quote.vendor)
        ? { field: 'vendor', status: 'ok', request: request.vendor, quote: quote.vendor, note: 'Same vendor.' }
        : { field: 'vendor', status: 'mismatch', request: request.vendor, quote: quote.vendor, note: 'The quote is from a different vendor.' },
  )

  const quoteCurrency = (quote.currency ?? request.currency).toUpperCase()
  if (quote.currency && quoteCurrency !== request.currency) {
    findings.push({
      field: 'currency',
      status: 'mismatch',
      request: request.currency,
      quote: quoteCurrency,
      note: 'The quote is in a different currency, so the totals can’t be compared directly.',
    })
  }

  if (quote.total === null) {
    findings.push({ field: 'total', status: 'unclear', request: money(request.amountCents, request.currency), quote: '(not found)', note: 'The quote has no clear total.' })
  } else {
    const quoteCents = Math.round(quote.total * 100)
    const difference = quoteCents - request.amountCents
    findings.push(
      difference === 0
        ? { field: 'total', status: 'ok', request: money(request.amountCents, request.currency), quote: money(quoteCents, quoteCurrency), note: 'The totals match.' }
        : {
            field: 'total',
            status: 'mismatch',
            request: money(request.amountCents, request.currency),
            quote: money(quoteCents, quoteCurrency),
            note: `The quote is ${money(Math.abs(difference), quoteCurrency)} ${difference > 0 ? 'more' : 'less'} than the request.`,
          },
    )
  }

  const validUntil = quote.validUntil ? new Date(`${quote.validUntil}T23:59:59Z`) : null
  if (!validUntil || Number.isNaN(validUntil.getTime())) {
    findings.push({ field: 'validity', status: 'unclear', request: 'Valid today', quote: '(no date found)', note: 'The quote doesn’t say how long it is valid.' })
  } else {
    const label = validUntil.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    findings.push(
      validUntil >= today
        ? { field: 'validity', status: 'ok', request: 'Valid today', quote: `Valid until ${label}`, note: 'The quote is still valid.' }
        : { field: 'validity', status: 'mismatch', request: 'Valid today', quote: `Expired ${label}`, note: 'The quote has expired; ask the vendor for a current one.' },
    )
  }

  findings.push({
    field: 'items',
    status: quote.itemsMatchRequest === 'yes' ? 'ok' : quote.itemsMatchRequest === 'no' ? 'mismatch' : 'unclear',
    request: request.title,
    quote: quote.items.map((i) => (i.quantity ? `${i.quantity} × ${i.description}` : i.description)).join('; ') || '(no items found)',
    note: quote.itemsNote,
  })

  const verdict: Verdict = findings.some((f) => f.status === 'mismatch')
    ? 'mismatch'
    : findings.some((f) => f.status === 'unclear')
      ? 'unclear'
      : 'match'
  return { verdict, findings }
}
