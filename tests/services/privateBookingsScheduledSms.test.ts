import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { getBookingScheduledSms } from '@/services/private-bookings/scheduled-sms'
import { DATE_TBD_NOTE } from '@/services/private-bookings/types'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

type BookingRow = Record<string, unknown>
type IdempRow = { idempotency_key: string }

function mockSupabase(opts: {
  booking?: BookingRow | null
  bookingError?: { message: string } | null
  idempRows?: IdempRow[]
}): void {
  const bookingSingle = vi.fn().mockResolvedValue({
    data: opts.booking ?? null,
    error:
      opts.bookingError ?? (opts.booking ? null : { message: 'not found' }),
  })
  const bookingEq = vi.fn().mockReturnValue({ single: bookingSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const idempEq = vi.fn().mockResolvedValue({
    data: opts.idempRows ?? [],
    error: null,
  })
  const idempSelect = vi.fn().mockReturnValue({ eq: idempEq })

  mockedCreateAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'private_bookings') return { select: bookingSelect }
      if (table === 'private_booking_send_idempotency')
        return { select: idempSelect }
      throw new Error(`Unexpected table in test: ${table}`)
    }),
  })
}

const BOOKING_ID = 'booking-123'
const NOW = new Date('2026-05-01T09:00:00.000Z')

function draftBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: BOOKING_ID,
    status: 'draft',
    customer_first_name: 'Sam',
    customer_name: 'Sam Smith',
    event_date: '2026-06-01',
    hold_expiry: '2026-05-08', // 7 days from NOW
    deposit_amount: 250,
    internal_notes: null,
    ...overrides,
  }
}

function confirmedBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: BOOKING_ID,
    status: 'confirmed',
    customer_first_name: 'Sam',
    customer_name: 'Sam Smith',
    event_date: '2026-05-15', // 14 days from NOW
    balance_due_date: '2026-05-08',
    total_amount: 1000,
    calculated_total: 1200,
    deposit_amount: 250,
    final_payment_date: null,
    internal_notes: null,
    guest_count: 40,
    post_event_outcome: 'pending',
    review_sms_sent_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED
  process.env.NODE_ENV = 'test'
})

describe('getBookingScheduledSms', () => {
  it('returns deposit_reminder_7day for draft booking with hold_expiry in 4-10 days', async () => {
    mockSupabase({ booking: draftBooking({ hold_expiry: '2026-05-08' }) })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const seven = result.find((r) => r.trigger_type === 'deposit_reminder_7day')
    expect(seven).toBeDefined()
    expect(seven?.suppression_reason).toBeNull()
    expect(seven?.preview_body).toContain('Sam')
    expect(seven?.preview_body).toContain('£250')
  })

  it('returns deposit_reminder_1day for draft booking with hold_expiry in 0-2 days', async () => {
    mockSupabase({ booking: draftBooking({ hold_expiry: '2026-05-02' }) }) // 1 day

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const oneDay = result.find((r) => r.trigger_type === 'deposit_reminder_1day')
    expect(oneDay).toBeDefined()
    expect(oneDay?.suppression_reason).toBeNull()
  })

  it('returns balance_reminder_14day for confirmed booking with balance outstanding', async () => {
    process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED = 'true'
    mockSupabase({ booking: confirmedBooking() })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const fourteen = result.find(
      (r) => r.trigger_type === 'balance_reminder_14day',
    )
    expect(fourteen).toBeDefined()
    expect(fourteen?.suppression_reason).toBeNull()
    expect(fourteen?.preview_body).toContain('Sam')
    expect(fourteen?.preview_body).toContain('£1200')
  })

  it('returns event_reminder_1d when event is tomorrow', async () => {
    process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED = 'true'
    mockSupabase({
      booking: confirmedBooking({
        event_date: '2026-05-02', // 1 day
        final_payment_date: '2026-04-20', // balance settled
      }),
    })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const ev = result.find((r) => r.trigger_type === 'event_reminder_1d')
    expect(ev).toBeDefined()
    expect(ev?.suppression_reason).toBeNull()
    expect(ev?.preview_body).toContain('tomorrow')
  })

  it('returns review_request when outcome is went_well and review_sms_sent_at is null', async () => {
    process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED = 'true'
    mockSupabase({
      booking: confirmedBooking({
        event_date: '2026-04-28', // 3 days ago
        post_event_outcome: 'went_well',
        review_sms_sent_at: null,
        final_payment_date: '2026-04-01',
      }),
    })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const review = result.find((r) => r.trigger_type === 'review_request')
    expect(review).toBeDefined()
    expect(review?.suppression_reason).toBeNull()
    expect(review?.preview_body).toContain('glad')
  })

  it('suppresses with feature_flag_disabled when PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED is off', async () => {
    process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED = 'false'
    mockSupabase({ booking: confirmedBooking() })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const fourteen = result.find(
      (r) => r.trigger_type === 'balance_reminder_14day',
    )
    expect(fourteen).toBeDefined()
    expect(fourteen?.suppression_reason).toBe('feature_flag_disabled')
    expect(fourteen?.expected_fire_at).toBeNull()
  })

  it('suppresses with date_tbd when isBookingDateTbd', async () => {
    mockSupabase({
      booking: draftBooking({
        internal_notes: `Some note. ${DATE_TBD_NOTE}`,
      }),
    })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const seven = result.find((r) => r.trigger_type === 'deposit_reminder_7day')
    expect(seven).toBeDefined()
    expect(seven?.suppression_reason).toBe('date_tbd')
    expect(seven?.expected_fire_at).toBeNull()
  })

  it('suppresses with already_sent when idempotency key already exists', async () => {
    mockSupabase({
      booking: draftBooking({ hold_expiry: '2026-05-08' }),
      idempRows: [
        {
          idempotency_key: `${BOOKING_ID}:deposit_reminder_7day:2026-05-08`,
        },
      ],
    })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const seven = result.find((r) => r.trigger_type === 'deposit_reminder_7day')
    expect(seven).toBeDefined()
    expect(seven?.suppression_reason).toBe('already_sent')
    expect(seven?.expected_fire_at).toBeNull()
  })

  it('returns empty array for cancelled booking', async () => {
    mockSupabase({
      booking: confirmedBooking({ status: 'cancelled' }),
    })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    expect(result).toEqual([])
  })

  it('returns empty array when booking lookup fails', async () => {
    mockSupabase({ booking: null, bookingError: { message: 'not found' } })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    expect(result).toEqual([])
  })

  it('skips review_request when review_sms_sent_at is set', async () => {
    process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED = 'true'
    mockSupabase({
      booking: confirmedBooking({
        event_date: '2026-04-28',
        post_event_outcome: 'went_well',
        review_sms_sent_at: '2026-04-29T10:00:00Z',
        final_payment_date: '2026-04-01',
      }),
    })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const review = result.find((r) => r.trigger_type === 'review_request')
    expect(review).toBeUndefined()
  })

  it('skips balance reminders when final_payment_date is set', async () => {
    process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED = 'true'
    mockSupabase({
      booking: confirmedBooking({
        final_payment_date: '2026-04-20',
      }),
    })

    const result = await getBookingScheduledSms(BOOKING_ID, NOW)

    const balance = result.find((r) =>
      r.trigger_type.startsWith('balance_reminder_'),
    )
    expect(balance).toBeUndefined()
  })
})
