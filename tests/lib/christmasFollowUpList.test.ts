import { describe, expect, it, vi } from 'vitest'

/**
 * The staff call list behind the Christmas follow-ups tab (Christmas funnel spec, owner decision
 * 7): website leads that never became a booking and lapsed Christmas holds, dated today onward.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { CHRISTMAS_PERIOD, leadsDb } from '../helpers/christmasLeadsDb'
import { listChristmasFollowUps, recordChristmasLeadCalled } from '@/lib/table-bookings/christmas-follow-up-list'

function lead(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    source: 'website',
    booking_period_id: CHRISTMAS_PERIOD.id,
    table_booking_id: null,
    first_name: 'Sam',
    last_name: 'Example',
    email: `${id}@example.com`,
    mobile_e164: null,
    booking_date: '2026-12-15',
    booking_time: '12:00:00',
    party_size: 12,
    created_at: '2026-11-19T15:00:00.000Z',
    follow_up_opt_out: false,
    follow_up_claimed_at: null,
    follow_up_sent_at: null,
    follow_up_outcome: null,
    called_at: null,
    call_note: null,
    ...overrides,
  }
}

describe('listChristmasFollowUps', () => {
  it('lists unfinished website leads and lapsed holds from today onward, soonest first', async () => {
    const { client } = leadsDb({
      table_booking_leads: [
        lead('later', { booking_date: '2026-12-18' }),
        lead('linked', { table_booking_id: 'booking-1' }),
        lead('past', { booking_date: '2026-11-19' }),
        lead('hold', { source: 'lapsed_hold', table_booking_id: 'booking-2', booking_date: '2026-12-01', follow_up_opt_out: true }),
        lead('today', { booking_date: '2026-11-20', booking_time: '18:00:00', follow_up_claimed_at: '2026-11-20T10:00:00.000Z', follow_up_outcome: 'sent', follow_up_sent_at: '2026-11-20T10:00:01.000Z' }),
      ],
    })

    const items = await listChristmasFollowUps(client, { today: '2026-11-20' })

    expect(items.map((item) => [item.leadId, item.source, item.followUpEmail, item.optedOut])).toEqual([
      ['today', 'website', 'sent', false],
      ['hold', 'lapsed_hold', 'not_sent', true],
      ['later', 'website', 'not_sent', false],
    ])
    expect(items[0]).toEqual(
      expect.objectContaining({ guestName: 'Sam Example', bookingTime: '18:00', partySize: 12, bookedSince: false }),
    )
  })

  it('marks a guest who has booked since, so staff need not ring them', async () => {
    const { client } = leadsDb({
      table_booking_leads: [lead('a')],
      table_bookings: [{ id: 'b1', customer_id: null, contact_email: 'a@example.com', booking_type: 'christmas', status: 'confirmed', booking_date: '2026-12-15' }],
    })

    const [item] = await listChristmasFollowUps(client, { today: '2026-11-20' })

    expect(item.bookedSince).toBe(true)
  })

  it('throws when the list cannot be read', async () => {
    const { fake, client } = leadsDb({ table_booking_leads: [lead('a')] })
    fake.failNext({ table: 'table_booking_leads', operation: 'select', message: 'statement timeout' })

    await expect(listChristmasFollowUps(client, { today: '2026-11-20' })).rejects.toThrow('statement timeout')
  })
})

describe('recordChristmasLeadCalled', () => {
  it('answers false for a lead that does not exist', async () => {
    const { client } = leadsDb()

    expect(await recordChristmasLeadCalled(client, { leadId: 'missing', userId: 'user-1', note: null })).toBe(false)
  })
})
