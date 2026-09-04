import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * THE CANCELLATION TEXT MUST NEVER GO QUIET ABOUT A GUEST'S MONEY.
 *
 * Two failures lived in this one message:
 *
 *  1. A failed or skipped refund fell to the same generic sentence a deposit-free booking
 *     gets, so a guest who had paid GBP 150 was told only "your booking has been cancelled.
 *     Hope to see you again soon!" while the venue kept it.
 *  2. The 50% tier had no wording of its own. Someone who paid GBP 150 and cancelled four
 *     days out read "your GBP 75.00 refund" as a full refund of a GBP 75 deposit, so the one
 *     number they could check looked wrong.
 */

const sendSMS = vi.fn().mockResolvedValue({ success: true })

vi.mock('@/lib/twilio', () => ({ sendSMS: (...args: unknown[]) => sendSMS(...args) }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: (n: string) => n }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: (body: string) => body }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))

const { sendTableBookingCancelledSmsIfAllowed } = await import('./bookings')

function fakeSupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: 'cust-1',
              first_name: 'Sarah',
              mobile_number: '+447700900123',
              sms_status: 'active',
            },
            error: null,
          }),
        }),
      }),
    }),
  } as never
}

async function sendWith(refundResult: Record<string, unknown>): Promise<string> {
  await sendTableBookingCancelledSmsIfAllowed(fakeSupabase(), {
    customerId: 'cust-1',
    bookingReference: 'TB-TEST',
    bookingDate: '2026-09-12',
    refundResult: refundResult as never,
  })
  expect(sendSMS).toHaveBeenCalled()
  return String(sendSMS.mock.calls.at(-1)?.[1] ?? '')
}

beforeEach(() => vi.clearAllMocks())

describe('cancellation SMS', () => {
  it('names the half tier so a partial refund does not read as a full one', async () => {
    const body = await sendWith({ refunded: true, amountPence: 7500, tier: 'half' })
    expect(body).toMatch(/£75\.00/)
    expect(body).toMatch(/half the deposit/i)
  })

  it('keeps the plain wording for a full refund', async () => {
    const body = await sendWith({ refunded: true, amountPence: 15000, tier: 'full' })
    expect(body).toMatch(/£150\.00 refund will land/)
    expect(body).not.toMatch(/half/i)
  })

  it('tells the guest when the refund failed, and names the amount owed', async () => {
    const body = await sendWith({
      refunded: false,
      reason: 'refund_failed',
      depositOwed: true,
      amountOwedPence: 15000,
    })
    expect(body).toMatch(/£150\.00/)
    expect(body).toMatch(/couldn't process/i)
    expect(body).toMatch(/by hand|be in touch/i)
  })

  it('still says something about the deposit when the owed amount is unknown', async () => {
    const body = await sendWith({ refunded: false, reason: 'refund_failed', depositOwed: true })
    expect(body).toMatch(/deposit refund/i)
    expect(body).toMatch(/be in touch/i)
  })

  it('promises a follow-up when the refund terms could not be read', async () => {
    const body = await sendWith({ refunded: false, reason: 'terms_unreadable' })
    expect(body).toMatch(/check your deposit/i)
  })

  it('keeps the existing non-refundable wording inside the cutoff', async () => {
    const body = await sendWith({ refunded: false, reason: 'zero_tier' })
    expect(body).toMatch(/within 3 days/i)
    expect(body).toMatch(/can't be refunded/i)
  })

  it('uses the generic sentence only when there was genuinely no deposit', async () => {
    const body = await sendWith({ refunded: false, reason: 'no_deposit' })
    expect(body).toMatch(/has been cancelled\. Hope to see you again soon!/)
    expect(body).not.toMatch(/deposit|refund/i)
  })
})
