import { describe, expect, it } from 'vitest'
import { displayQuoteStatus, summariseQuotes } from '@/lib/quotes/summary'

describe('summariseQuotes', () => {
  const today = '2026-11-18'

  it('counts a sent quote past its date as expired and one on its last day as pending', () => {
    const summary = summariseQuotes(
      [
        { status: 'sent', total_amount: 10, valid_until: '2026-11-17' },
        { status: 'sent', total_amount: '20.5', valid_until: '2026-11-18' },
        { status: 'expired', total_amount: 99, valid_until: '2026-01-01' },
        { status: 'rejected', total_amount: 99, valid_until: '2027-01-01' },
        { status: 'accepted', total_amount: null, valid_until: '2027-01-01' },
        { status: 'accepted', total_amount: 30, valid_until: '2027-01-01' },
        { status: 'draft', total_amount: 99, valid_until: '2027-01-01' },
      ],
      today,
    )

    expect(summary).toEqual({ total_pending: 20.5, total_expired: 10, total_accepted: 30, draft_badge: 1 })
  })

  it('shows only a lapsed sent quote as expired', () => {
    expect(displayQuoteStatus('sent', '2026-11-17', today)).toBe('expired')
    expect(displayQuoteStatus('sent', '2026-11-18', today)).toBe('sent')
    expect(displayQuoteStatus('accepted', '2026-11-17', today)).toBe('accepted')
  })
})
