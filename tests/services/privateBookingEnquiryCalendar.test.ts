import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({
  db: null as any,
}))

// Confirming needs a room that fits the guests and a contract sent (owner decisions D24 and
// D25). This file is about something else, so every booking here passes those checks; they are
// tested in tests/services/privateHireReadiness.test.ts.
vi.mock('@/services/private-bookings/readiness', async (importOriginal) =>
  (await import('../helpers/readyHire')).readyHireReadiness(importOriginal))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async () => false),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(async () => 'event-1'),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => true),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(async () => ({ customerId: 'customer-1' })),
}))

vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true, channel: 'sms' })),
}))

vi.mock('@/lib/email/private-booking-emails', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email/private-booking-emails')>('@/lib/email/private-booking-emails')
  return {
    ...actual,
    sendBookingConfirmationEmail: vi.fn(async () => undefined),
    sendBookingCalendarInvite: vi.fn(async () => undefined),
  }
})

import { syncCalendarEvent } from '@/lib/google-calendar'
import { PrivateBookingService } from '@/services/private-bookings'

/**
 * D28, BK-156: a website enquiry stays off the Pub Ops calendar until staff have spoken to the
 * guest and saved its date and times. It used to appear at a made-up 12:00.
 */

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'draft',
    source: 'website',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: 'host@example.com',
    event_type: 'Birthday party',
    event_date: '2026-11-21',
    start_time: '12:00:00',
    end_time: null,
    end_time_next_day: false,
    setup_date: null,
    setup_time: null,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: null,
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    deposit_confirmed_at: null,
    balance_due_date: '2026-11-07',
    calendar_event_id: null,
    risk_status: 'normal',
    ...overrides,
  }
}

function seed(rows: Record<string, unknown>[] = []) {
  state.db = createFakeSupabase({
    private_bookings: rows,
    private_booking_sms_queue: [],
    private_booking_audit: [],
    signing_documents: [],
    customers: [{ id: 'customer-1', email: 'alex@example.com', mobile_number: '+447700900123' }],
  })
  state.db.rpc = vi.fn(async (_name: string, args: { p_booking_data: Record<string, unknown> }) => {
    const row = { ...args.p_booking_data, id: 'booking-new', deposit_confirmed_at: null, created_by: null }
    state.db.tables.private_bookings.push(row)
    return { data: { ...row }, error: null }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('website enquiries and the Pub Ops calendar', () => {
  it('a new website enquiry is not put on the calendar', async () => {
    seed()
    await PrivateBookingService.createBooking({
      customer_first_name: 'Alex',
      contact_phone: '07700 900123',
      contact_email: 'host@example.com',
      event_date: '2026-11-21',
      guest_count: 40,
      status: 'draft',
      source: 'website',
      is_web_enquiry: true,
    } as never, { client: state.db })
    expect(syncCalendarEvent).not.toHaveBeenCalled()
  })

  it('a booking staff make is put on the calendar as before', async () => {
    seed()
    await PrivateBookingService.createBooking({
      customer_first_name: 'Alex',
      contact_phone: '07700 900123',
      event_date: '2026-11-21',
      start_time: '19:00',
      guest_count: 40,
      source: 'phone',
      created_by: 'user-1',
    } as never, { client: state.db })
    expect(syncCalendarEvent).toHaveBeenCalledTimes(1)
  })

  it('stays off when staff edit something other than the date or times', async () => {
    seed([bookingRow()])
    await PrivateBookingService.updateBooking('booking-1', { internal_notes: 'Rang, no answer' } as never, 'user-1')
    expect(syncCalendarEvent).not.toHaveBeenCalled()
  })

  it('joins the calendar once staff save its date and times', async () => {
    seed([bookingRow()])
    await PrivateBookingService.updateBooking('booking-1', { start_time: '19:00', end_time: '23:00' } as never, 'user-1')
    expect(syncCalendarEvent).toHaveBeenCalledTimes(1)
  })

  it('an enquiry already on the calendar keeps being updated', async () => {
    seed([bookingRow({ calendar_event_id: 'existing-event' })])
    await PrivateBookingService.updateBooking('booking-1', { internal_notes: 'Rang, no answer' } as never, 'user-1')
    expect(syncCalendarEvent).toHaveBeenCalledTimes(1)
  })
})
