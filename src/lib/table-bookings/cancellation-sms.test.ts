import { describe, expect, it, vi, beforeEach } from 'vitest'
import { assertCleanText } from '../../../tests/mocks/emailRenderChecks'

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

vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: (body: string) => body }))

// The words themselves. Since BK-129 the notice always goes email first, and this text is what the
// fallback and the bounce fallback send, built by the one function both use.
const { buildTableBookingCancelledText } = await import('./guest-texts')

async function sendWith(refundResult: Record<string, unknown>): Promise<string> {
  return buildTableBookingCancelledText({
    firstName: 'Sarah',
    bookingDate: '2026-09-12',
    refundResult: refundResult as never,
  })
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

  it('says what has already gone back when this refund is only the rest of it', async () => {
    const body = await sendWith({ refunded: true, amountPence: 10000, tier: 'full', alreadyReturnedPence: 5000 })
    expect(body).toMatch(/already had £50\.00 of the deposit back/)
    expect(body).toMatch(/remaining £100\.00 will land/)
    expect(body).not.toMatch(/undefined|NaN/)
  })

  it('keeps the half tier named when part of it has already gone back', async () => {
    const body = await sendWith({ refunded: true, amountPence: 2500, tier: 'half', alreadyReturnedPence: 5000 })
    expect(body).toMatch(/half the deposit is refundable/i)
    expect(body).toMatch(/already had £50\.00 back/)
    expect(body).toMatch(/remaining £25\.00 will land/)
    expect(body).not.toMatch(/undefined|NaN/)
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

  it('names the Christmas 7-day rule, not the 3-day one, inside a seasonal cutoff', async () => {
    // BK-003: a Christmas cancellation 5 days out was told "within 3 days".
    const body = await sendWith({ refunded: false, reason: 'seasonal_cutoff', cutoffDays: 7 })
    expect(body).toMatch(/fewer than 7 days before your booking, the deposit can't be refunded/i)
    expect(body).not.toMatch(/3 days/)
    // BK-221: a Christmas booking with no refund due renders with no zero amount or gap.
    assertCleanText(body)
  })

  it('says a deposit with no refund window was never refundable', async () => {
    const body = await sendWith({ refunded: false, reason: 'seasonal_cutoff', cutoffDays: 0 })
    expect(body).toMatch(/wasn't refundable/i)
    expect(body).not.toMatch(/\d+ days/)
    assertCleanText(body)
  })

  it('still names no rule it cannot see when the cutoff is unknown', async () => {
    const body = await sendWith({ refunded: false, reason: 'seasonal_cutoff' })
    expect(body).toMatch(/inside the cancellation deadline/i)
    expect(body).not.toMatch(/3 days/)
  })

  // BK-113: a hold that ran out unpaid used to be cancelled with no word of why.
  it('says the deposit was not paid in time when the payment hold ran out, with the pub number', async () => {
    const body = await sendWith({ refunded: false, reason: 'hold_expired' })
    expect(body).toMatch(/^The Anchor: Sarah, your booking on .+ has been cancelled\. /)
    expect(body).toContain(
      "has been cancelled. The deposit wasn't paid in time, so the table has been released. If you'd still like to come, call us on 01753 682707."
    )
    // Plain GSM-7 characters only: one curly apostrophe or dash halves what fits in a text.
    expect(body).toMatch(/^[\x20-\x7E]+$/)
  })

  it('uses the generic sentence only when there was genuinely no deposit', async () => {
    const body = await sendWith({ refunded: false, reason: 'no_deposit' })
    expect(body).toMatch(/has been cancelled\. Hope to see you again soon!/)
    expect(body).not.toMatch(/deposit|refund/i)
  })
})

// BK-046 (owner decision D7): when the pub cancels, the text says sorry, says it was us, and the
// deposit comes back in full. BK-041 (D19): a cash deposit is owed back across the bar.
describe('cancellation SMS when the pub cancels, or the deposit was cash', () => {
  it('apologises and refunds in full when the pub cancels', async () => {
    const body = await sendWith({ refunded: true, amountPence: 16000, tier: 'full', cancelledBy: 'venue' })
    expect(body).toBe(
      "The Anchor: Sarah, we're sorry, but we've had to cancel your booking on Sat, 12 Sept 2026. We're refunding your £160.00 deposit in full. It will land within 5-10 days."
    )
  })

  it('says what has already gone back when the pub cancels a part-refunded deposit', async () => {
    const body = await sendWith({ refunded: true, amountPence: 10000, tier: 'full', alreadyReturnedPence: 6000, cancelledBy: 'venue' })
    expect(body).toContain("we've had to cancel")
    expect(body).toContain("You've already had £60.00 of the deposit back, so the remaining £100.00 will land within 5-10 days.")
  })

  it('gives the number to rebook when the pub cancels a booking with no deposit', async () => {
    const body = await sendWith({ refunded: false, reason: 'no_deposit', cancelledBy: 'venue' })
    expect(body).toContain("we've had to cancel your booking")
    expect(body).toMatch(/If you'd like to book another time, call us on 01753 682707\.$/)
  })

  it("keeps the guest's own wording when the guest asked", async () => {
    const body = await sendWith({ refunded: false, reason: 'zero_tier', cancelledBy: 'guest' })
    expect(body).toContain('has been cancelled.')
    expect(body).not.toContain('sorry')
  })

  it('says a cash deposit is owed and where to collect it', async () => {
    const body = await sendWith({ refunded: false, reason: 'cash_refund_due', depositOwed: true, amountOwedPence: 16000 })
    expect(body).toContain("We owe you your £160.00 cash deposit. Collect it from the bar, or call us on 01753 682707 and we'll sort it out.")
  })

  it('still says the cash is owed when the amount is unknown', async () => {
    const body = await sendWith({ refunded: false, reason: 'cash_refund_due', depositOwed: true })
    expect(body).toContain('We owe you your cash deposit.')
    expect(body).not.toMatch(/undefined|NaN|£0\.00/)
  })
})
