import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({
  db: null as any,
  depositConfirmation: true,
}))

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
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

import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import { logger } from '@/lib/logger'
import { PrivateBookingService } from '@/services/private-bookings'

const mockedSend = sendPrivateBookingMessage as unknown as Mock

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
    event_date: '2026-11-21',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    setup_date: null,
    setup_time: null,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: '2026-09-25T22:30:00.000Z',
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
    customers: [{ id: 'customer-1', email: 'alex@example.com', mobile_number: '+447700900123' }],
  })
  // The create RPC inserts the row and returns it, as create_private_booking_transaction does.
  state.db.rpc = vi.fn(async (_name: string, args: { p_booking_data: Record<string, unknown> }) => {
    const row = { ...args.p_booking_data, id: 'booking-new', deposit_confirmed_at: null, created_by: 'user-1' }
    state.db.tables.private_bookings.push(row)
    return { data: { ...row }, error: null }
  })
}

async function flushBackgroundSends() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const createInput = {
  customer_first_name: 'Alex',
  customer_last_name: 'Smith',
  customer_id: 'customer-1',
  contact_phone: '07700 900123',
  contact_email: 'host@example.com',
  event_date: '2026-11-21',
  start_time: '19:00',
  guest_count: 40,
  event_type: 'Birthday party',
  source: 'phone',
  created_by: 'user-1',
}

describe('creating a private booking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    state.depositConfirmation = true
    seed()
  })

  it('with deposit confirmation on, sends nothing about the deposit and leaves it to be confirmed', async () => {
    const booking = await PrivateBookingService.createBooking(createInput)
    await flushBackgroundSends()

    expect(booking.id).toBe('booking-new')
    expect(mockedSend).not.toHaveBeenCalled()
    const row = state.db.tables.private_bookings.find((r: any) => r.id === 'booking-new')
    expect(row.deposit_confirmed_at).toBeNull()
    // The date is still held, exactly as before: the hold is what blocks the space.
    expect(row.hold_expiry).toEqual(expect.any(String))
    expect(row.deposit_amount).toBe(250)
  })

  it('from the website Christmas form (/api/external/create-booking, admin client) also sends nothing', async () => {
    await PrivateBookingService.createBooking(
      { ...createInput, source: 'website', status: 'draft', created_by: undefined },
      { client: state.db }
    )
    await flushBackgroundSends()

    expect(mockedSend).not.toHaveBeenCalled()
    expect(state.db.tables.private_bookings[0].deposit_confirmed_at).toBeNull()
  })

  it('with the flag off, sends the booking created text as today and records the deposit as confirmed', async () => {
    state.depositConfirmation = false

    await PrivateBookingService.createBooking(createInput)
    await vi.waitFor(() => expect(mockedSend).toHaveBeenCalledTimes(1))

    expect(mockedSend.mock.calls[0][0].sms).toMatchObject({ trigger_type: 'booking_created', template_key: 'private_booking_created' })
    const row = state.db.tables.private_bookings[0]
    expect(row.deposit_confirmed_at).toEqual(expect.any(String))
    expect(row.deposit_confirmed_by).toBe('user-1')
  })

  it('with the flag off, a failed confirmation stamp never blocks the booking or its text', async () => {
    state.depositConfirmation = false
    state.db.failures.push({ table: 'private_bookings', op: 'update', error: { code: 'PGRST204', message: "Could not find the 'deposit_confirmed_at' column" } })

    const booking = await PrivateBookingService.createBooking(createInput)
    await vi.waitFor(() => expect(mockedSend).toHaveBeenCalledTimes(1))

    expect(booking.id).toBe('booking-new')
    expect(logger.warn).toHaveBeenCalledWith('Deposit not recorded as confirmed at booking time', expect.anything())
  })

  it.each([true, false])('a website enquiry stays silent and unconfirmed (flag %s)', async (flag) => {
    state.depositConfirmation = flag

    await PrivateBookingService.createBooking({ ...createInput, is_web_enquiry: true }, { client: state.db })
    await flushBackgroundSends()

    expect(mockedSend).not.toHaveBeenCalled()
    expect(state.db.tables.private_bookings[0].deposit_confirmed_at).toBeNull()
    expect(state.db.tables.private_bookings[0].hold_expiry).toBeNull()
  })

  it('a waived deposit still confirms the booking with no deposit to pay, flag on', async () => {
    await PrivateBookingService.createBooking({
      ...createInput,
      deposit_amount: 0,
      deposit_waived: true,
      deposit_waived_reason: 'Venue-hosted event',
    })
    await vi.waitFor(() => expect(mockedSend).toHaveBeenCalledTimes(1))

    expect(mockedSend.mock.calls[0][0].sms.trigger_type).toBe('booking_confirmed')
  })
})

describe('extending the hold on a booking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    state.depositConfirmation = true
  })

  it('with the deposit to be confirmed: the hold moves, and the guest is not told a deadline', async () => {
    seed([bookingRow()])

    const result = await PrivateBookingService.extendHold('booking-1', 7, 'user-1', 'Customer needs a week')

    expect(result).toMatchObject({ success: true, smsSent: false, guestNotNotifiedReason: 'deposit_to_be_confirmed' })
    expect(state.db.tables.private_bookings[0].hold_expiry).toBe(result.newExpiry)
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('with the deposit confirmed: the hold-extended message goes as before', async () => {
    seed([bookingRow({ deposit_confirmed_at: '2026-09-11T10:00:00.000Z' })])

    const result = await PrivateBookingService.extendHold('booking-1', 7, 'user-1', 'Customer needs a week')

    expect(result.guestNotNotifiedReason).toBeUndefined()
    expect(mockedSend).toHaveBeenCalledTimes(1)
    expect(mockedSend.mock.calls[0][0].sms.trigger_type).toBe('hold_extended')
  })

  it('with the flag off, an unconfirmed deposit is extended and messaged exactly as today', async () => {
    state.depositConfirmation = false
    seed([bookingRow()])

    await PrivateBookingService.extendHold('booking-1', 7, 'user-1', 'Customer needs a week')

    expect(mockedSend).toHaveBeenCalledTimes(1)
  })

  it('when the deposit state cannot be read, no message goes', async () => {
    seed([bookingRow({ deposit_confirmed_at: '2026-09-11T10:00:00.000Z' })])
    const originalFrom = state.db.from
    let privateBookingReads = 0
    state.db.from = (table: string) => {
      const builder = originalFrom(table)
      if (table !== 'private_bookings') return builder
      const originalSelect = builder.select
      builder.select = (columns?: string) => {
        if (columns?.includes('deposit_confirmed_at')) {
          privateBookingReads += 1
          state.db.failures.push({ table: 'private_bookings', op: 'select', error: { message: 'timeout' } })
        }
        return originalSelect(columns)
      }
      return builder
    }

    const result = await PrivateBookingService.extendHold('booking-1', 7, 'user-1', 'Customer needs a week')

    expect(privateBookingReads).toBe(1)
    expect(result.smsSent).toBe(false)
    expect(mockedSend).not.toHaveBeenCalled()
  })
})

describe('moving a booking to Confirmed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    state.depositConfirmation = true
  })

  it('is refused while the deposit is to be confirmed, and nothing is sent', async () => {
    seed([bookingRow()])

    await expect(PrivateBookingService.updateBookingStatus('booking-1', 'confirmed', 'user-1')).rejects.toThrow(
      'Confirm the deposit before confirming this booking'
    )

    expect(state.db.tables.private_bookings[0].status).toBe('draft')
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('goes ahead once the deposit is confirmed', async () => {
    seed([bookingRow({ deposit_confirmed_at: '2026-09-11T10:00:00.000Z' })])

    await PrivateBookingService.updateBookingStatus('booking-1', 'confirmed', 'user-1')

    expect(state.db.tables.private_bookings[0].status).toBe('confirmed')
  })

  it('goes ahead when the deposit is waived to £0 in the same edit', async () => {
    seed([bookingRow()])

    await PrivateBookingService.updateBooking(
      'booking-1',
      { status: 'confirmed', deposit_amount: 0, deposit_waived: true, deposit_waived_reason: 'Regular customer' },
      'user-1'
    )

    expect(state.db.tables.private_bookings[0].status).toBe('confirmed')
  })

  it('with the flag off goes ahead exactly as today', async () => {
    state.depositConfirmation = false
    seed([bookingRow()])

    await PrivateBookingService.updateBookingStatus('booking-1', 'confirmed', 'user-1')

    expect(state.db.tables.private_bookings[0].status).toBe('confirmed')
  })
})
