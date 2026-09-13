import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notifyCustomerMock = vi.fn()

vi.mock('@/lib/notifications/notify', () => ({
  notifyCustomer: (input: unknown) => notifyCustomerMock(input),
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn(async () => ({ success: true, code: null, logFailure: false })) }))
vi.mock('@/lib/guest/tokens', () => ({
  createGuestToken: vi.fn(async () => ({ rawToken: 'raw' })),
  hashGuestToken: vi.fn(() => 'hashed'),
}))
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(async () => ({
    rawToken: 'raw',
    url: 'https://example.test/g/raw/table-manage',
    expiresAt: '2026-12-07T19:00:00.000Z',
  })),
}))
vi.mock('@/lib/guest/guest-short-link', () => ({
  buildGuestShortLink: vi.fn(async ({ linkKind }: { linkKind: string }) => ({
    url: linkKind === 'table_payment' ? 'https://l.the-anchor.pub/pay1' : 'https://l.the-anchor.pub/m1',
    shortened: true,
  })),
}))
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: vi.fn(async () => undefined) } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ from: vi.fn() })) }))

import { sendTableBookingRescheduledNotificationIfAllowed } from './bookings'

/**
 * The booking-amended notice.
 *
 * Two defects from the 11 September review: it said "still confirmed" to a `pending_payment`
 * booking that still owed a deposit, and it fired on a duration change with only the new time in
 * it, which the guest cannot check.
 */

const CUSTOMER = {
  id: 'cust-1',
  first_name: 'Sam',
  last_name: 'Jones',
  mobile_e164: '+447700900123',
  mobile_number: '+447700900123',
  email: 'sam@example.test',
  sms_status: 'active',
  sms_opt_in: true,
  marketing_sms_opt_in: true,
  email_status: 'active',
  email_deactivated_at: null,
  marketing_email_opt_in: true,
}

const CONFIRMED_BOOKING = {
  id: 'tb-1',
  customer_id: 'cust-1',
  booking_reference: 'TB-0001',
  booking_date: '2026-12-05',
  booking_time: '19:00:00',
  start_datetime: '2026-12-05T19:00:00.000Z',
  party_size: 6,
  status: 'confirmed',
  payment_status: null,
  booking_type: 'regular',
  high_chair_count: 0,
  is_outside_seating: false,
  deposit_amount: null,
  deposit_amount_locked: null,
  deposit_waived: false,
  deposit_rate: null,
  deposit_basis: null,
  deposit_refund_cutoff_days: null,
  hold_expires_at: null,
}

function supabase(booking: Record<string, unknown>) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: table === 'customers' ? CUSTOMER : booking,
            error: null,
          })),
        })),
      })),
    })),
  } as never
}

function captureNotice() {
  return notifyCustomerMock.mock.calls[0]?.[0] as {
    email?: { subject?: string; text?: string }
    sms?: { body?: string }
  }
}

describe('the booking amended notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'))
    notifyCustomerMock.mockResolvedValue({
      selectedChannels: ['email'],
      attempts: [{ channel: 'email', success: true }],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says what the booking was as well as what it is now', async () => {
    await sendTableBookingRescheduledNotificationIfAllowed(supabase(CONFIRMED_BOOKING), {
      tableBookingId: 'tb-1',
      previous: { startDateTime: '2026-12-05T17:00:00.000Z' },
    })

    const notice = captureNotice()
    expect(notice.email?.text).toContain('It was Saturday 5 December 2026 at 5pm.')
    expect(notice.email?.text).toContain('is still confirmed')
    expect(notice.sms?.body).toContain('It was Sat 5 Dec, 5:00 pm.')
  })

  it('sends nothing when only the duration moved', async () => {
    await sendTableBookingRescheduledNotificationIfAllowed(supabase(CONFIRMED_BOOKING), {
      tableBookingId: 'tb-1',
      // The same start and the same party size: the guest sees no change at all.
      previous: { startDateTime: '2026-12-05T19:00:00.000Z', partySize: 6 },
    })

    expect(notifyCustomerMock).not.toHaveBeenCalled()
  })

  it('never tells an unpaid booking it is still confirmed', async () => {
    await sendTableBookingRescheduledNotificationIfAllowed(
      supabase({
        ...CONFIRMED_BOOKING,
        status: 'pending_payment',
        payment_status: 'pending',
        party_size: 16,
        deposit_amount: 160,
        deposit_rate: 10,
        deposit_basis: 'per_head',
        hold_expires_at: '2026-11-02T10:00:00.000Z',
      }),
      {
        tableBookingId: 'tb-1',
        previous: { startDateTime: '2026-12-05T17:00:00.000Z' },
      },
    )

    const notice = captureNotice()
    expect(notice.email?.text).not.toContain('still confirmed')
    expect(notice.sms?.body).not.toContain('still confirmed')
    // The deposit, the pay-by time and the link, restated.
    expect(notice.email?.text).toContain('we still need your deposit of £160.00')
    expect(notice.email?.text).toContain('which is when the hold on your table runs out')
    expect(notice.email?.text).toContain('Pay your deposit: https://l.the-anchor.pub/pay1')
    expect(notice.sms?.body).toContain('Pay your deposit: https://l.the-anchor.pub/pay1')
  })

  it('offers no payment link once the hold has already run out', async () => {
    await sendTableBookingRescheduledNotificationIfAllowed(
      supabase({
        ...CONFIRMED_BOOKING,
        status: 'pending_payment',
        payment_status: 'pending',
        party_size: 16,
        deposit_amount: 160,
        deposit_rate: 10,
        deposit_basis: 'per_head',
        hold_expires_at: '2026-10-30T10:00:00.000Z',
      }),
      {
        tableBookingId: 'tb-1',
        previous: { startDateTime: '2026-12-05T17:00:00.000Z' },
      },
    )

    const notice = captureNotice()
    expect(notice.email?.text).not.toContain('Pay your deposit: ')
    expect(notice.email?.text).toContain('we still need your deposit of £160.00')
    expect(notice.email?.text).not.toContain('Invalid Date')
  })

  it('still refuses to message a cancelled booking', async () => {
    await sendTableBookingRescheduledNotificationIfAllowed(
      supabase({ ...CONFIRMED_BOOKING, status: 'cancelled' }),
      { tableBookingId: 'tb-1', previous: { startDateTime: '2026-12-05T17:00:00.000Z' } },
    )

    expect(notifyCustomerMock).not.toHaveBeenCalled()
  })
})
