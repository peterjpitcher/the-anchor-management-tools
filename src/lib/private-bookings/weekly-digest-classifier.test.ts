import { describe, it, expect } from 'vitest'
import {
  classifyBookingTier,
  hasOutstandingBalance,
  type WeeklyDigestBookingRow,
  type ClassificationContext,
} from './weekly-digest-classifier'

/** Helper to build a base booking row with sensible defaults */
function makeRow(overrides: Partial<WeeklyDigestBookingRow> = {}): WeeklyDigestBookingRow {
  return {
    id: 'booking-1',
    customer_name: 'Test Customer',
    customer_first_name: 'Test',
    customer_last_name: 'Customer',
    status: 'confirmed',
    event_date: '2026-04-15',
    start_time: '18:00',
    hold_expiry: null,
    updated_at: '2026-03-22T10:00:00Z',
    guest_count: 20,
    event_type: 'birthday',
    contact_email: 'test@example.com',
    contact_phone: '+447700900000',
    balance_due_date: null,
    balance_remaining: 0,
    final_payment_date: '2026-03-20',
    internal_notes: null,
    ...overrides,
  }
}

/** Helper to build a default classification context */
function makeCtx(overrides: Partial<ClassificationContext> = {}): ClassificationContext {
  return {
    now: new Date('2026-03-22T12:00:00Z'),
    todayDateKey: '2026-03-22',
    endOfWeekDateKey: '2026-03-29',
    pendingSmsCount: 0,
    ...overrides,
  }
}

describe('hasOutstandingBalance', () => {
  it('returns true when balance_remaining > 0 and final_payment_date is null', () => {
    const row = makeRow({ balance_remaining: 100, final_payment_date: null })
    expect(hasOutstandingBalance(row)).toBe(true)
  })

  it('returns false when balance_remaining is 0', () => {
    const row = makeRow({ balance_remaining: 0, final_payment_date: null })
    expect(hasOutstandingBalance(row)).toBe(false)
  })

  it('returns false when final_payment_date is set', () => {
    const row = makeRow({ balance_remaining: 100, final_payment_date: '2026-03-20' })
    expect(hasOutstandingBalance(row)).toBe(false)
  })

  it('returns false when balance_remaining is null', () => {
    const row = makeRow({ balance_remaining: null, final_payment_date: null })
    expect(hasOutstandingBalance(row)).toBe(false)
  })
})

describe('classifyBookingTier', () => {
  const ctx = makeCtx()

  // 1. Confirmed and paid → Tier 3
  it('returns Tier 3 for a confirmed, paid booking', () => {
    const row = makeRow()
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(3)
    expect(result.labels).toEqual([])
  })

  // 2. Draft with expired hold → Tier 1
  it('returns Tier 1 with "Hold expired" for draft with expired hold', () => {
    const row = makeRow({
      status: 'draft',
      hold_expiry: '2026-03-21T10:00:00Z', // yesterday
      event_date: '2026-06-01',
      updated_at: '2026-03-22T10:00:00Z',
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContain('Hold expired')
  })

  // 3. Draft event within 14 days → Tier 1
  it('returns Tier 1 with "Event in X days" for draft event within 14 days', () => {
    const row = makeRow({
      status: 'draft',
      event_date: '2026-03-29', // 7 days away
      hold_expiry: '2026-04-01T10:00:00Z', // not expired
      updated_at: '2026-03-22T10:00:00Z',
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContainEqual(expect.stringMatching(/Event in 7 days — still draft/))
  })

  // 4. Overdue balance → Tier 1
  it('returns Tier 1 with "Balance overdue" for overdue balance', () => {
    const row = makeRow({
      balance_due_date: '2026-03-20', // 2 days ago
      balance_remaining: 150,
      final_payment_date: null,
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContainEqual(expect.stringMatching(/Balance overdue: £150\.00/))
  })

  // 5. Stale draft (not updated 7+ days) → Tier 1
  it('returns Tier 1 with "Not touched in X days" for stale draft', () => {
    const row = makeRow({
      status: 'draft',
      updated_at: '2026-03-10T10:00:00Z', // 12 days ago
      event_date: '2026-06-01', // far away
      hold_expiry: '2026-04-01T10:00:00Z', // not expired
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContainEqual(expect.stringMatching(/Not touched in 12 days/))
  })

  // 6. Missing guest count → Tier 1
  it('returns Tier 1 with "Missing: guest count" when guest_count is null', () => {
    const row = makeRow({ guest_count: null })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContainEqual(expect.stringMatching(/Missing:.*guest count/))
  })

  // 7. Missing contact (both email and phone null) → Tier 1
  it('returns Tier 1 with "Missing: contact info" when both email and phone are null', () => {
    const row = makeRow({ contact_email: null, contact_phone: null })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContainEqual(expect.stringMatching(/Missing:.*contact info/))
  })

  // 8. Balance due this week → Tier 1
  it('returns Tier 1 with "Balance due" for balance due this week', () => {
    const row = makeRow({
      balance_due_date: '2026-03-25', // within this week
      balance_remaining: 200,
      final_payment_date: null,
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContainEqual(expect.stringMatching(/Balance due: £200\.00 by 2026-03-25/))
  })

  // 9. Multiple triggers on same booking → all labels present
  it('returns multiple labels when multiple Tier 1 triggers match', () => {
    const row = makeRow({
      status: 'draft',
      hold_expiry: '2026-03-21T10:00:00Z', // expired
      event_date: '2026-03-29', // 7 days away
      updated_at: '2026-03-10T10:00:00Z', // stale
      guest_count: null,
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels.length).toBeGreaterThanOrEqual(3)
    expect(result.labels).toContainEqual(expect.stringMatching(/Hold expired/))
    expect(result.labels).toContainEqual(expect.stringMatching(/Event in 7 days/))
    expect(result.labels).toContainEqual(expect.stringMatching(/Not touched in 12 days/))
    expect(result.labels).toContainEqual(expect.stringMatching(/Missing:.*guest count/))
  })

  // 10. Hold expiring within 48h → Tier 2
  it('returns Tier 2 with "Hold expires" for hold expiring within 48h', () => {
    const row = makeRow({
      status: 'draft',
      hold_expiry: '2026-03-23T10:00:00Z', // ~22h from now
      event_date: '2026-06-01',
      updated_at: '2026-03-22T10:00:00Z',
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(2)
    expect(result.labels).toContainEqual(expect.stringMatching(/Hold expires 2026-03-23/))
  })

  // 11. Pending SMS → Tier 2
  it('returns Tier 2 with "N SMS pending approval" when pendingSmsCount > 0', () => {
    const row = makeRow()
    const result = classifyBookingTier(row, makeCtx({ pendingSmsCount: 3 }))
    expect(result.tier).toBe(2)
    expect(result.labels).toContain('3 SMS pending approval')
  })

  // 12. Date/time TBC → Tier 2
  it('returns Tier 2 with "Date/time TBC" when internal_notes contains TBC text', () => {
    const row = makeRow({ internal_notes: 'Event date/time to be confirmed - awaiting customer' })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(2)
    expect(result.labels).toContain('Date/time TBC')
  })

  // 13. Confirmed but unpaid, not overdue → Tier 2
  it('returns Tier 2 with "Outstanding" for confirmed unpaid booking not overdue', () => {
    const row = makeRow({
      status: 'confirmed',
      balance_remaining: 300,
      final_payment_date: null,
      balance_due_date: '2026-04-15', // future
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(2)
    expect(result.labels).toContainEqual(expect.stringMatching(/Outstanding: £300\.00/))
  })

  // 14. T1 wins over T2 when both match
  it('returns Tier 1 when both Tier 1 and Tier 2 triggers match', () => {
    const row = makeRow({
      status: 'draft',
      hold_expiry: '2026-03-21T10:00:00Z', // expired (T1)
      event_date: '2026-06-01',
      updated_at: '2026-03-22T10:00:00Z',
      internal_notes: 'Event date/time to be confirmed', // T2
    })
    const result = classifyBookingTier(row, makeCtx({ pendingSmsCount: 2 }))
    expect(result.tier).toBe(1)
    // Only T1 labels should be present, not T2
    expect(result.labels).toContain('Hold expired')
    expect(result.labels).not.toContain('Date/time TBC')
    expect(result.labels).not.toContain('2 SMS pending approval')
  })

  // 15. Confirmed booking with balance due this week → Tier 1 only (not Tier 2)
  it('returns Tier 1 for confirmed booking with balance due this week', () => {
    const row = makeRow({
      status: 'confirmed',
      balance_due_date: '2026-03-25',
      balance_remaining: 100,
      final_payment_date: null,
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContainEqual(expect.stringMatching(/Balance due: £100\.00 by 2026-03-25/))
    // Should NOT also have the T2 "Outstanding" label
    expect(result.labels).not.toContainEqual(expect.stringMatching(/Outstanding/))
  })

  // 16. Null event_date → no crash
  it('does not crash when event_date is null', () => {
    const row = makeRow({ event_date: null })
    expect(() => classifyBookingTier(row, ctx)).not.toThrow()
    const result = classifyBookingTier(row, ctx)
    expect([1, 2, 3]).toContain(result.tier)
  })

  // 17. Null balance_due_date with balance > 0 → Tier 3
  it('returns Tier 3 when balance_due_date is null even with balance remaining', () => {
    const row = makeRow({
      balance_due_date: null,
      balance_remaining: 500,
      final_payment_date: null,
    })
    // No balance_due_date means we can't trigger overdue or due-this-week
    // Confirmed + unpaid + balance_due_date null → T2 "confirmed but unpaid" check
    // requires balance_due_date >= todayDateKey which is false when null
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(3)
  })

  // 18. Zero balance_remaining → no balance triggers
  it('does not trigger balance labels when balance_remaining is 0', () => {
    const row = makeRow({
      balance_due_date: '2026-03-20', // past
      balance_remaining: 0,
      final_payment_date: null,
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.labels).not.toContainEqual(expect.stringMatching(/Balance/))
    expect(result.labels).not.toContainEqual(expect.stringMatching(/Outstanding/))
  })

  // 19. final_payment_date set → no balance triggers
  it('does not trigger balance labels when final_payment_date is set', () => {
    const row = makeRow({
      balance_due_date: '2026-03-20',
      balance_remaining: 500,
      final_payment_date: '2026-03-19',
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.labels).not.toContainEqual(expect.stringMatching(/Balance/))
    expect(result.labels).not.toContainEqual(expect.stringMatching(/Outstanding/))
  })

  // 20. Boundary: event_date exactly 14 days away
  it('triggers "Event in 14 days" for draft with event_date exactly 14 days away', () => {
    const row = makeRow({
      status: 'draft',
      event_date: '2026-04-05', // exactly 14 days from 2026-03-22
      hold_expiry: '2026-04-10T10:00:00Z',
      updated_at: '2026-03-22T10:00:00Z',
    })
    const result = classifyBookingTier(row, ctx)
    expect(result.tier).toBe(1)
    expect(result.labels).toContainEqual(expect.stringMatching(/Event in 14 days — still draft/))
  })
})
