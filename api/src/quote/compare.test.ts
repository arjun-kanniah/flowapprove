import { describe, expect, it } from 'vitest'
import { compareQuote, sameVendor } from './compare.js'
import type { QuoteExtraction } from './schema.js'

const request = {
  vendor: 'Contoso Supplies',
  amountCents: 86_000,
  currency: 'USD',
  title: 'Docking stations',
  description: 'Four USB-C docks',
}
const today = new Date('2026-10-13T12:00:00Z')

function quote(patch: Partial<QuoteExtraction> = {}): QuoteExtraction {
  return {
    readable: true,
    vendor: 'Contoso Supplies',
    quoteNumber: 'CS-1',
    currency: 'USD',
    total: 860,
    validUntil: '2026-11-30',
    items: [{ description: 'USB-C docking station', quantity: 4, amount: 860 }],
    itemsMatchRequest: 'yes',
    itemsNote: 'Four docks, as requested.',
    ...patch,
  }
}

const status = (q: QuoteExtraction) =>
  Object.fromEntries(compareQuote(request, q, today).findings.map((f) => [f.field, f.status]))

describe('compareQuote', () => {
  it('passes a quote that agrees on every point', () => {
    expect(compareQuote(request, quote(), today).verdict).toBe('match')
  })

  it('flags a different total in code, whatever the model thinks of the items', () => {
    const result = compareQuote(request, quote({ total: 1075 }), today)
    expect(result.verdict).toBe('mismatch')
    expect(result.findings.find((f) => f.field === 'total')?.note).toBe(
      'The quote is $215.00 more than the request.',
    )
  })

  it('catches a total off by a cent', () => {
    expect(status(quote({ total: 860.01 })).total).toBe('mismatch')
  })

  it('flags an expired quote, and accepts one valid through today', () => {
    expect(status(quote({ validUntil: '2026-08-02' })).validity).toBe('mismatch')
    expect(status(quote({ validUntil: '2026-10-13' })).validity).toBe('ok')
  })

  it('flags a different vendor and a different currency', () => {
    expect(status(quote({ vendor: 'Fabrikam Electronics' })).vendor).toBe('mismatch')
    expect(status(quote({ currency: 'EUR' })).currency).toBe('mismatch')
  })

  it('is unclear, not a match, when something can’t be read', () => {
    expect(compareQuote(request, quote({ validUntil: null }), today).verdict).toBe('unclear')
    expect(compareQuote(request, quote({ readable: false }), today).verdict).toBe('unclear')
  })

  it('uses the model’s judgement only for the items', () => {
    const result = compareQuote(request, quote({ itemsMatchRequest: 'no' }), today)
    expect(result.verdict).toBe('mismatch')
    expect(status(quote({ itemsMatchRequest: 'no' })).total).toBe('ok')
  })
})

describe('sameVendor', () => {
  it('ignores case, punctuation and company suffixes', () => {
    expect(sameVendor('Contoso Supplies', 'CONTOSO SUPPLIES, INC.')).toBe(true)
    expect(sameVendor('Ergo Works', 'Ergo Works LLC')).toBe(true)
    expect(sameVendor('Northwind Displays', 'Fabrikam Electronics')).toBe(false)
  })
})
