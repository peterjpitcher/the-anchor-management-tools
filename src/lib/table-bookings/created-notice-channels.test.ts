import { assertCleanText } from '../../../tests/mocks/emailRenderChecks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Every external transport is stubbed, per the workspace rule: this suite never sends anything.
const notifyCustomerMock = vi.fn()

vi.mock('@/lib/notifications/notify', () => ({
  notifyCustomer: (input: unknown) => notifyCustomerMock(input),
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn(async () => ({ success: true, code: null, logFailure: false })) }))
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

import { sendTableBookingCreatedSmsIfAllowed, type TableBookingRpcResult } from './bookings'
import { resolveNotificationRoute } from '@/lib/notifications/routing-matrix'
import { selectChannel } from '@/lib/notifications/channel'

/**
 * Which channels the booking notice goes on, and what a seasonal booking is told.
 *
 * Two defects from the 11 September review:
 *
 *  - The website sends `skip_customer_sms` for a booking it is handing to PayPal. The caller
 *    skipped the whole notice for those, so every website booking of 15 or more and every
 *    website Christmas booking went out with no confirmation at all.
 *  - A staff-made Christmas booking with two and three course guests was confirmed with a
 *    "Manage your booking" link and no word about choosing food or the deadline for it.
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

function supabase(periodRow: Record<string, unknown> | null = { preorder_cutoff_days: 7 }) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: table === 'booking_periods' ? periodRow : CUSTOMER,
            error: null,
          })),
        })),
      })),
    })),
  } as never
}

function captureNotice() {
  return notifyCustomerMock.mock.calls[0]?.[0] as {
    policy?: string
    email?: { subject?: string; html?: string; text?: string }
    sms?: { body?: string }
  }
}

describe('the booking notice channels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyCustomerMock.mockResolvedValue({
      selectedChannels: ['email'],
      attempts: [{ channel: 'email', success: true }],
    })
  })

  const pendingPayment: TableBookingRpcResult = {
    state: 'pending_payment',
    table_booking_id: 'tb-1',
    booking_reference: 'TB-0001',
    party_size: 16,
    start_datetime: '2026-12-05T19:00:00.000Z',
    hold_expires_at: '2026-11-20T18:00:00.000Z',
    deposit_amount: 160,
    deposit_rate: 10,
    deposit_basis: 'per_head',
    deposit_refund_cutoff_days: null,
    high_chair_count: 0,
    is_outside_seating: false,
  }

  it('emails the deposit request even when the text is suppressed', async () => {
    await sendTableBookingCreatedSmsIfAllowed(supabase(), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: pendingPayment,
      nextStepUrl: 'https://example.test/g/raw/table-payment',
      skipCustomerSms: true,
    })

    const notice = captureNotice()
    expect(notice.policy).toBe('email_only')
    // And the real router (notifyCustomer is stood in for here) holds that policy for this
    // template: email or nothing, never the text the guest asked not to get (BK-085).
    const route = resolveNotificationRoute({ templateKey: 'table_booking_pending_payment', policy: 'email_only' })
    expect(route.channels).toEqual(['email'])
    expect(
      selectChannel({
        policy: 'email_only',
        urgency: 'standard',
        eligibility: { email: false, whatsapp: true, sms: true },
        orderedChannels: route.channels,
      })
    ).toEqual({ channels: [], reason: 'no_channel_available' })
    expect(notice.email?.subject).toBe('Pay your deposit to secure your table at The Anchor')
    // The four facts the old email left out: what the money is, that it comes off the bill, the
    // deadline, and what comes back on a cancellation.
    expect(notice.email?.text).toContain('please pay your table deposit of £160.00')
    expect(notice.email?.text).toContain('Groups of 15 or more: a £10 per person deposit, fully deducted from your bill.')
    expect(notice.email?.text).toContain('which is when the hold on your table runs out')
    expect(notice.email?.text).toContain('Cancel 7 or more days before and the deposit is refunded in full.')
  })

  it('still sends on both channels when nothing is suppressed', async () => {
    await sendTableBookingCreatedSmsIfAllowed(supabase(), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: pendingPayment,
      nextStepUrl: 'https://example.test/g/raw/table-payment',
    })

    expect(captureNotice().policy).toBe('email_first')
  })

  it('tells a seasonal booking to choose its food, with the deadline', async () => {
    await sendTableBookingCreatedSmsIfAllowed(supabase(), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: {
        state: 'confirmed',
        table_booking_id: 'tb-1',
        booking_reference: 'TB-0002',
        party_size: 6,
        start_datetime: '2026-12-05T19:00:00.000Z',
        booking_period_id: 'period-xmas',
        booking_period_name: 'Christmas 2026',
        booking_period_requires_preorder: true,
        booking_period_answer: true,
        christmas_course_counts: [1, 2, 3, 3, 3, 3],
        high_chair_count: 0,
        is_outside_seating: false,
      },
    })

    const notice = captureNotice()
    // The text already said "Choose your food"; the email now says it too, and says by when.
    expect(notice.sms?.body).toContain('Choose your food:')
    expect(notice.email?.text).toContain('Choose your food: https://l.the-anchor.pub/m1')
    expect(notice.email?.text).toContain("Two and three courses need everyone's choices 7 days before your booking.")
    expect(notice.email?.text).toContain('Every guest on three courses needs a starter, a main and a dessert chosen.')
  })

  it('leaves the deadline out when the period cannot be read', async () => {
    await sendTableBookingCreatedSmsIfAllowed(supabase(null), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: {
        state: 'confirmed',
        table_booking_id: 'tb-1',
        booking_reference: 'TB-0003',
        party_size: 6,
        start_datetime: '2026-12-05T19:00:00.000Z',
        booking_period_id: 'period-xmas',
        booking_period_requires_preorder: true,
        booking_period_answer: true,
        christmas_course_counts: [2, 2, 3, 3, 3, 3],
        high_chair_count: 0,
        is_outside_seating: false,
      },
    })

    const notice = captureNotice()
    expect(notice.email?.text).toContain('Choose your food')
    expect(notice.email?.text).not.toContain('days before your booking')
    expect(notice.email?.text).not.toContain('undefined')
  })
})

// BK-049: the deposit request recomputed the amount from party size and always printed
// "(N x GBP 10)", so the first season charged at another rate, or per booking, would have asked
// the guest for a wrong amount (often GBP 0) while PayPal asked for the real one.
describe('the deposit request quotes what the booking function charged', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyCustomerMock.mockResolvedValue({
      selectedChannels: ['email'],
      attempts: [{ channel: 'email', success: true }],
    })
  })

  const base: TableBookingRpcResult = {
    state: 'pending_payment',
    table_booking_id: 'tb-2',
    booking_reference: 'TB-0002',
    start_datetime: '2027-03-07T13:00:00.000Z',
    hold_expires_at: '2027-03-06T13:00:00.000Z',
    deposit_refund_cutoff_days: 3,
    high_chair_count: 0,
    is_outside_seating: false,
    booking_type: 'regular',
  }

  async function send(result: TableBookingRpcResult) {
    await sendTableBookingCreatedSmsIfAllowed(supabase(), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: result,
      nextStepUrl: 'https://example.test/g/raw/table-payment',
    })
    return captureNotice()
  }

  it("a party of 2 at GBP 15 a head is asked for GBP 30, named for the season", async () => {
    const notice = await send({
      ...base,
      party_size: 2,
      deposit_amount: 30,
      deposit_rule: 'period',
      deposit_basis: 'per_head',
      deposit_rate: 15,
      booking_period_name: "Mother's Day",
    })

    expect(notice.sms?.body).toContain("please pay your Mother's Day deposit of £30.00 (2 x GBP 15) to secure your table for 2 people")
    expect(notice.email?.text).toContain("please pay your Mother's Day deposit of £30.00 (2 x GBP 15)")
    expect(notice.email?.text).toContain("There's a £15 per person deposit, which comes off your bill.")
    expect(notice.email?.text).not.toContain('Groups of 15 or more')
    expect(notice.email?.text).not.toMatch(/£0\.00|GBP 10\)/)
    assertCleanText(notice.sms?.body ?? '')
    assertCleanText(notice.email?.text ?? '')
  })

  it('a per-booking period shows its flat amount and no sum', async () => {
    const notice = await send({
      ...base,
      party_size: 6,
      deposit_amount: 50,
      deposit_rule: 'period',
      deposit_basis: 'per_booking',
      deposit_rate: 50,
      booking_period_name: "New Year's Eve",
    })

    expect(notice.sms?.body).toContain("please pay your New Year's Eve deposit of £50.00 to secure your table for 6 people")
    expect(notice.email?.text).toContain('The deposit comes off your bill.')
    expect(notice.email?.text).not.toContain(' x GBP ')
    expect(notice.email?.text).not.toContain('Groups of 15 or more')
    assertCleanText(notice.sms?.body ?? '')
    assertCleanText(notice.email?.text ?? '')
  })

  it('the group deposit keeps its wording', async () => {
    const notice = await send({
      ...base,
      party_size: 16,
      deposit_amount: 160,
      deposit_rule: 'group',
      deposit_basis: 'per_head',
      deposit_rate: 10,
      deposit_refund_cutoff_days: null,
    })

    expect(notice.sms?.body).toContain('please pay your table deposit of £160.00 (16 x GBP 10)')
    expect(notice.email?.text).toContain('Groups of 15 or more: a £10 per person deposit, fully deducted from your bill.')
  })

  it('a Christmas deposit is called one', async () => {
    const notice = await send({
      ...base,
      party_size: 6,
      deposit_amount: 60,
      deposit_rule: 'period',
      deposit_basis: 'per_head',
      deposit_rate: 10,
      booking_type: 'christmas',
      booking_period_name: 'Christmas 2026',
      deposit_refund_cutoff_days: 7,
    })

    expect(notice.sms?.body).toContain('please pay your Christmas deposit of £60.00 (6 x GBP 10)')
    expect(notice.email?.text).toContain("There's a £10 per person deposit, which comes off your bill.")
  })
})
