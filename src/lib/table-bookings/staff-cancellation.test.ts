import { describe, expect, it } from 'vitest'
import {
  depositHeldGbp,
  initialStaffCancelForm,
  parseStaffCancellation,
  readStaffCancelForm,
  staffCancellationBody,
} from './staff-cancellation'

/** BK-046: the staff cancel form and request, read the same way by the screens and the routes. */
describe('who is cancelling, as staff send it', () => {
  it('needs a choice before it sends anything', () => {
    expect(readStaffCancelForm(initialStaffCancelForm(160), 160)).toEqual({ ok: false, error: 'Choose who is cancelling.' })
  })

  it('starts a manager amount from what the guest paid and still has with us', () => {
    expect(initialStaffCancelForm(160).amountText).toBe('160.00')
    expect(depositHeldGbp({ payment_status: 'completed', deposit_amount_locked: 160 }, 40)).toBe(120)
    expect(depositHeldGbp({ payment_status: 'refunded', deposit_amount_locked: 160 })).toBe(0)
    expect(depositHeldGbp({ payment_status: 'pending', deposit_amount: 160 })).toBe(0)
  })

  it('refuses an amount above what is held, or nothing', () => {
    const base = { cancelledBy: 'venue' as const, chooseAmount: true }
    expect(readStaffCancelForm({ ...base, amountText: '200' }, 160)).toEqual({ ok: false, error: 'Enter a refund between £0.01 and £160.00.' })
    expect(readStaffCancelForm({ ...base, amountText: '0' }, 160).ok).toBe(false)
    expect(readStaffCancelForm({ ...base, amountText: '40.5' }, 160)).toEqual({
      ok: true,
      choice: { cancelledBy: 'venue', refundAmountGbp: 40.5 },
    })
  })

  it('sends the rule, not an amount, unless a manager chose one', () => {
    const read = readStaffCancelForm({ cancelledBy: 'guest', chooseAmount: false, amountText: '160.00' }, 160)
    expect(read).toEqual({ ok: true, choice: { cancelledBy: 'guest', refundAmountGbp: null } })
    expect(staffCancellationBody({ cancelledBy: 'guest', refundAmountGbp: null })).toEqual({ cancelled_by: 'guest' })
  })

  it('reads a request the same way on the server', () => {
    expect(parseStaffCancellation({ cancelled_by: 'venue', refund_amount_gbp: '40.00' })).toEqual({
      ok: true,
      choice: { cancelledBy: 'venue', refundAmountGbp: 40, choiceGiven: true },
    })
    expect(parseStaffCancellation(null)).toEqual({
      ok: true,
      choice: { cancelledBy: 'guest', refundAmountGbp: null, choiceGiven: false },
    })
    expect(parseStaffCancellation({ cancelled_by: 'venue', refund_amount_gbp: -5 }).ok).toBe(false)
    expect(parseStaffCancellation({ cancelled_by: 'someone' }).ok).toBe(false)
  })
})
