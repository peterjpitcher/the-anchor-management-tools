import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * Hold deadlines that cancelled paid or reinstated hires (customer bookings review, 24 October
 * 2026):
 * - BK-067: a cancelled booking moved back to draft kept its old, expired hold, so the 06:00 job
 *   cancelled it again the next morning and told the guest their hold had lapsed.
 * - BK-068: moving a paid draft's date, or extending its hold, set a new deadline; when it passed
 *   the job cancelled a booking the guest had paid for.
 * - BK-110: a capped hold ended at 00:00 UTC on its deadline day, the event day for a short-notice
 *   booking, so the job cancelled it that morning.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/services/private-bookings/readiness', async (importOriginal) =>
  (await import('../helpers/readyHire')).readyHireReadiness(importOriginal))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn(async () => ({ customerId: 'customer-1' })) }))
vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true, channel: 'email' })),
}))
vi.mock('@/services/private-bookings/conflicts', () => ({
  getBookingConflictSummary: vi.fn(async () => []),
  getBookingSpaceIds: vi.fn(async () => []),
  findBookingConflicts: vi.fn(async () => []),
  checkCapacity: vi.fn(() => ({ ok: true })),
}))

import { PrivateBookingService } from '@/services/private-bookings'

// 10:00 in London on Wednesday 21 October 2026.
const NOW = new Date('2026-10-21T09:00:00.000Z')

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: 'host@example.com',
    event_type: 'Birthday party',
    event_date: '2026-12-12',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    setup_date: null,
    setup_time: null,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: '2026-10-28T23:59:59.000Z',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    deposit_confirmed_at: '2026-10-14T10:00:00.000Z',
    balance_due_date: '2026-11-28',
    calendar_event_id: null,
    risk_status: 'normal',
    ...overrides,
  }
}

function seed(row: Record<string, unknown>) {
  state.db = createFakeSupabase({
    private_bookings: [row],
    private_booking_sms_queue: [],
    private_booking_audit: [],
    customers: [{ id: 'customer-1', email: 'alex@example.com', mobile_number: '+447700900123' }],
  })
  state.db.rpc = vi.fn(async (_name: string, args: { p_booking_data: Record<string, unknown> }) => {
    const created = { ...args.p_booking_data, id: 'booking-new', deposit_confirmed_at: null, created_by: 'user-1' }
    state.db.tables.private_bookings.push(created)
    return { data: { ...created }, error: null }
  })
}

function stored(id = 'booking-1'): Record<string, any> {
  return state.db.tables.private_bookings.find((row: Record<string, unknown>) => row.id === id)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BK-067: reinstating a cancelled booking', () => {
  const cancelled = {
    status: 'cancelled',
    cancelled_at: '2026-10-10T09:00:00.000Z',
    cancellation_reason: 'Deposit hold expired',
    hold_expiry: '2026-10-09T22:59:59.000Z',
  }

  it('gives it a fresh hold instead of the one that had already passed, and audits it', async () => {
    seed(bookingRow(cancelled))

    await PrivateBookingService.updateBookingStatus('booking-1', 'draft', 'user-1')

    const row = stored()
    expect(row.status).toBe('draft')
    // The creation rule from today: 14 days, to the end of 4 November (GMT).
    expect(row.hold_expiry).toBe('2026-11-04T23:59:59.000Z')
    expect(Date.parse(row.hold_expiry)).toBeGreaterThan(NOW.getTime())
    expect(state.db.tables.private_booking_audit).toEqual([
      expect.objectContaining({
        booking_id: 'booking-1',
        action: 'reinstated',
        old_value: 'cancelled',
        new_value: 'draft',
        metadata: { previous_hold_expiry: '2026-10-09T22:59:59.000Z', hold_expiry: '2026-11-04T23:59:59.000Z' },
      }),
    ])
  })

  it('keeps a hold that is still in the future', async () => {
    seed(bookingRow({ ...cancelled, hold_expiry: '2026-10-30T23:59:59.000Z' }))

    await PrivateBookingService.updateBookingStatus('booking-1', 'draft', 'user-1')

    expect(stored().hold_expiry).toBe('2026-10-30T23:59:59.000Z')
  })

  it('gives a booking whose deposit is paid no hold at all', async () => {
    seed(bookingRow({ ...cancelled, deposit_paid_date: '2026-10-05T10:00:00.000Z' }))

    await PrivateBookingService.updateBookingStatus('booking-1', 'draft', 'user-1')

    expect(stored().hold_expiry).toBeNull()
  })
})

describe('BK-068: a draft whose deposit is paid or waived has no hold', () => {
  it('moving a paid draft to another date sets no deadline', async () => {
    seed(bookingRow({ hold_expiry: null, deposit_paid_date: '2026-10-05T10:00:00.000Z' }))

    await PrivateBookingService.updateBooking('booking-1', { event_date: '2026-12-19' }, 'user-1')

    expect(stored().event_date).toBe('2026-12-19')
    expect(stored().hold_expiry).toBeNull()
  })

  it('moving a waived draft sets no deadline either', async () => {
    seed(bookingRow({ hold_expiry: null, deposit_amount: 0, deposit_waived: true }))

    await PrivateBookingService.updateBooking('booking-1', { event_date: '2026-12-19' }, 'user-1')

    expect(stored().hold_expiry).toBeNull()
  })

  it('moving an unpaid draft still gives it a new hold, as before', async () => {
    seed(bookingRow())

    await PrivateBookingService.updateBooking('booking-1', { event_date: '2026-12-19' }, 'user-1')

    expect(stored().hold_expiry).toBe('2026-11-04T23:59:59.000Z')
  })

  it('refuses to extend the hold on a paid draft', async () => {
    seed(bookingRow({ hold_expiry: null, deposit_paid_date: '2026-10-05T10:00:00.000Z' }))

    await expect(PrivateBookingService.extendHold('booking-1', 7, 'user-1', 'Guest asked for more time')).rejects.toThrow(
      'The deposit has been paid or waived, so this booking has no hold to extend',
    )
    expect(stored().hold_expiry).toBeNull()
  })
})

describe('BK-110: a capped hold keeps the whole of its last day', () => {
  it('an extension inside the 14-day window ends with the day before the event, not on it', async () => {
    seed(bookingRow({ event_date: '2026-10-31', hold_expiry: '2026-10-23T22:59:59.000Z', balance_due_date: '2026-10-21' }))

    const result = await PrivateBookingService.extendHold('booking-1', 30, 'user-1', 'Guest asked for more time')

    // 30 October is GMT: its last instant is 23:59:59Z.
    expect(stored().hold_expiry).toBe('2026-10-30T23:59:59.000Z')
    expect(result).toMatchObject({ capped: true })
  })

  it('a deadline typed by staff past the balance deadline runs to the end of that deadline day', async () => {
    seed(bookingRow())

    await PrivateBookingService.createBooking({
      customer_first_name: 'Alex',
      customer_last_name: 'Smith',
      customer_id: 'customer-1',
      contact_email: 'host@example.com',
      event_date: '2026-11-21',
      start_time: '19:00',
      guest_count: 40,
      event_type: 'Birthday party',
      source: 'phone',
      created_by: 'user-1',
      hold_expiry: '2026-11-20',
    })

    // The balance deadline is 7 November, 14 days before the event: the whole of that day, GMT.
    expect(stored('booking-new').hold_expiry).toBe('2026-11-07T23:59:59.000Z')
  })

  it('a deadline typed for a short-notice booking never runs into the event day', async () => {
    seed(bookingRow())

    await PrivateBookingService.createBooking({
      customer_first_name: 'Alex',
      customer_last_name: 'Smith',
      customer_id: 'customer-1',
      contact_email: 'host@example.com',
      event_date: '2026-10-25',
      start_time: '19:00',
      guest_count: 40,
      event_type: 'Birthday party',
      source: 'phone',
      created_by: 'user-1',
      hold_expiry: '2026-10-25',
    })

    // The day before the event, 24 October, is still BST.
    expect(stored('booking-new').hold_expiry).toBe('2026-10-24T22:59:59.000Z')
  })
})
