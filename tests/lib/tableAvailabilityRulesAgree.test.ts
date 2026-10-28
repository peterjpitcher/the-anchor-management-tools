import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { mapTableBookingBlockedReason } from '@/lib/table-bookings/bookings'
import {
  DEFAULT_TABLE_BOOKING_PARTY_LIMIT,
  guestPartyLimitMessage,
  readTableBookingPartyLimit,
} from '@/lib/table-bookings/party-limit'
import { quoteTableBookingDeposit } from '@/lib/table-bookings/deposit-quote'

/** Release 24 of the customer bookings review of 24 October 2026 (BK-144, BK-146, BK-186). */

function settingsClient(result: unknown) {
  return {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
    })),
  } as never
}

describe('BK-144: a drinks or outside refusal keeps its own reason', () => {
  it('passes drinks_full and outside_full on, instead of the generic blocked', () => {
    expect(mapTableBookingBlockedReason('drinks_full')).toBe('drinks_full')
    expect(mapTableBookingBlockedReason('outside_full')).toBe('outside_full')
    expect(mapTableBookingBlockedReason('slot_full')).toBe('slot_full')
    expect(mapTableBookingBlockedReason('something_new')).toBe('blocked')
  })
})

describe('BK-146, D30: one party limit, read from the setting', () => {
  it('reads table_booking_max_party_online', async () => {
    expect(await readTableBookingPartyLimit(settingsClient({ data: { value: { value: 16 } }, error: null }))).toBe(16)
  })

  it('falls back to 20, as the booking functions do, when the setting is missing, bad or unreadable', async () => {
    expect(DEFAULT_TABLE_BOOKING_PARTY_LIMIT).toBe(20)
    expect(await readTableBookingPartyLimit(settingsClient({ data: null, error: null }))).toBe(20)
    expect(await readTableBookingPartyLimit(settingsClient({ data: { value: { value: 'lots' } }, error: null }))).toBe(20)
    expect(await readTableBookingPartyLimit(settingsClient({ data: null, error: { message: 'down' } }))).toBe(20)
    const throwing = { from: () => { throw new Error('no table') } } as never
    expect(await readTableBookingPartyLimit(throwing)).toBe(20)
  })

  it('points a bigger group to a call or a private hire enquiry', () => {
    expect(guestPartyLimitMessage(20)).toBe(
      'For more than 20 guests, please call us on 01753 682707 or send us a private hire enquiry.',
    )
  })
})

describe('BK-186: the deposit quote comes from resolve_table_booking_deposit', () => {
  it('maps the answer and rounds to pence', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true, required: true, amount: '150.004', rule: 'group', reason: 'x' }, error: null }))
    const quote = await quoteTableBookingDeposit({ rpc } as never, { date: '2026-11-07', partySize: 15 })
    expect(quote).toEqual({ party_size: 15, required: true, amount: 150, rule: 'group', reason: 'x' })
  })

  it('quotes nothing for a refusal or a broken answer', async () => {
    const refused = vi.fn(async () => ({ data: { ok: false, error_code: 'period_party_too_small' }, error: null }))
    expect(await quoteTableBookingDeposit({ rpc: refused } as never, { date: '2026-12-12', partySize: 2, periodId: 'p', periodAnswer: true })).toBeNull()
    const broken = vi.fn(async () => ({ data: { ok: true, amount: 'NaN' }, error: null }))
    expect(await quoteTableBookingDeposit({ rpc: broken } as never, { date: '2026-11-07', partySize: 15 })).toBeNull()
  })
})
