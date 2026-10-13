import { describe, expect, it } from 'vitest'
import { describeEvent, money, when } from './format'

describe('format', () => {
  it('formats cents as dollars', () => {
    expect(money(123456)).toBe('$1,234.56')
    expect(money(5000)).toBe('$50.00')
  })

  it('says how long ago, then the date', () => {
    const now = new Date('2026-10-13T12:00:00Z')
    expect(when('2026-10-13T11:59:40Z', now)).toBe('just now')
    expect(when('2026-10-13T11:15:00Z', now)).toBe('45 min ago')
    expect(when('2026-10-13T07:00:00Z', now)).toBe('5 h ago')
    expect(when('2026-10-01T12:00:00Z', now)).toBe('Oct 1, 2026')
  })

  it('describes timeline entries', () => {
    expect(describeEvent('submit', 'changes_requested', 'pending_manager')).toBe('resubmitted')
    expect(describeEvent('approve', 'pending_manager', 'pending_finance')).toMatch(/finance/)
    expect(describeEvent('approve', 'pending_finance', 'approved')).toMatch(/request approved/)
  })
})
