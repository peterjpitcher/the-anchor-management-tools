import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, depositConfirmation: true }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) =>
    key === 'private_booking_deposit_confirmation' ? state.depositConfirmation : false
  ),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { getBookingScheduledSms } from '@/services/private-bookings/scheduled-sms'
import { fetchPrivateBookings } from '@/services/private-bookings/queries'
import { logger } from '@/lib/logger'

const NOW = new Date('2026-09-20T09:00:00.000Z')

function draft(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'draft',
    customer_first_name: 'Sam',
    customer_name: 'Sam Smith',
    event_date: '2026-10-31',
    start_time: '19:00:00',
    hold_expiry: '2026-09-25T22:30:00.000Z',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    internal_notes: null,
    invoice_id: null,
    invoice_deposit_treatment: null,
    gross_total: 1200,
    ...overrides,
  }
}

function seed(bookings: Record<string, unknown>[]) {
  state.db = createFakeSupabase({
    private_bookings: bookings,
    private_bookings_with_details: bookings.map(({ deposit_confirmed_at: _hidden, deposit_waived: _alsoHidden, ...viewColumns }) => viewColumns),
    private_booking_send_idempotency: [],
    private_booking_payments: [],
  })
}

describe('the Communications tab preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.depositConfirmation = true
  })

  it('lists no deposit reminder while the deposit is still to be confirmed', async () => {
    seed([draft('booking-1', { deposit_confirmed_at: null })])

    const previews = await getBookingScheduledSms('booking-1', NOW)

    expect(previews.filter((preview) => preview.trigger_type.startsWith('deposit_reminder_'))).toEqual([])
  })

  it('lists the reminder once the deposit is confirmed', async () => {
    seed([draft('booking-1', { deposit_confirmed_at: '2026-09-11T10:00:00.000Z' })])

    const previews = await getBookingScheduledSms('booking-1', NOW)

    expect(previews.map((preview) => preview.trigger_type)).toContain('deposit_reminder_7day')
  })

  it('with the flag off lists it exactly as today', async () => {
    state.depositConfirmation = false
    seed([draft('booking-1', { deposit_confirmed_at: null })])

    const previews = await getBookingScheduledSms('booking-1', NOW)

    expect(previews.map((preview) => preview.trigger_type)).toContain('deposit_reminder_7day')
  })
})

describe('the private bookings list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.depositConfirmation = true
  })

  it('marks each booking whose deposit is still to be confirmed, and only those', async () => {
    seed([
      draft('waiting', { deposit_confirmed_at: null }),
      draft('confirmed', { deposit_confirmed_at: '2026-09-11T10:00:00.000Z' }),
      draft('waived', { deposit_confirmed_at: null, deposit_amount: 0, deposit_waived: true }),
      draft('paid', { deposit_confirmed_at: null, status: 'confirmed', deposit_paid_date: '2026-09-12' }),
    ])

    const { data } = await fetchPrivateBookings({ status: 'all', dateFilter: 'all' })

    const marked = Object.fromEntries(data.map((booking) => [booking.id, booking.deposit_awaiting_confirmation]))
    expect(marked).toEqual({ waiting: true, confirmed: false, waived: false, paid: false })
  })

  it('with the flag off marks none', async () => {
    state.depositConfirmation = false
    seed([draft('waiting', { deposit_confirmed_at: null })])

    const { data } = await fetchPrivateBookings({ status: 'all', dateFilter: 'all' })

    expect(data[0].deposit_awaiting_confirmation).toBe(false)
  })

  it('still lists the bookings when the confirmation read fails, marking none and logging it', async () => {
    seed([draft('waiting', { deposit_confirmed_at: null })])
    const originalFrom = state.db.from
    state.db.from = (table: string) => {
      const builder = originalFrom(table)
      if (table !== 'private_bookings') return builder
      const originalSelect = builder.select
      builder.select = (columns?: string) => {
        if (columns?.includes('deposit_confirmed_at')) {
          state.db.failures.push({ table: 'private_bookings', op: 'select', error: { code: '42703', message: 'no such column' } })
        }
        return originalSelect(columns)
      }
      return builder
    }

    const { data } = await fetchPrivateBookings({ status: 'all', dateFilter: 'all' })

    expect(data).toHaveLength(1)
    expect(data[0].deposit_awaiting_confirmation).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('Could not read deposit confirmations for the private bookings list', expect.anything())
  })
})
