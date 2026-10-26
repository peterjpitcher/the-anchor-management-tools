import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  describeDepositRefundForStaff,
  readDepositRefundOutcome,
  toDepositRefundOutcome,
} from './deposit-refund-outcome'

/**
 * BK-114: a staff cancellation refunded the deposit, or failed to, and told the person who
 * cancelled nothing. A refund that did not go through, leaving the guest owed money, looked
 * exactly like one that did.
 */

describe('the deposit refund outcome a staff cancellation reports', () => {
  it('says a refund was sent, with the amount', () => {
    const outcome = toDepositRefundOutcome({ refunded: true, amountPence: 4000, refundId: 'R-1', tier: 'full' })
    expect(describeDepositRefundForStaff(outcome)).toEqual({ tone: 'success', message: 'Deposit refund of £40.00 sent to the guest.' })
  })

  it('says, as an error, that the guest is owed money when the refund did not go through', () => {
    const outcome = toDepositRefundOutcome({ refunded: false, reason: 'refund_failed', depositOwed: true, amountOwedPence: 4000 })
    expect(describeDepositRefundForStaff(outcome)).toEqual({
      tone: 'error',
      message: 'The deposit refund did not go through, so the guest is owed £40.00. Refund it by hand in PayPal. A manager has been emailed.',
    })
  })

  it('says, as an error, that the refunds already made could not be read', () => {
    const result = describeDepositRefundForStaff(toDepositRefundOutcome({ refunded: false, reason: 'terms_unreadable' }))
    expect(result?.tone).toBe('error')
    expect(result?.message).toContain('Check the Refund History')
  })

  it('says no refund is due inside the cutoff, naming the cutoff that applied', () => {
    expect(describeDepositRefundForStaff(toDepositRefundOutcome({ refunded: false, reason: 'seasonal_cutoff', cutoffDays: 7 }))?.message)
      .toBe('No deposit refund is due: the booking was cancelled inside its 7-day refund cutoff.')
    expect(describeDepositRefundForStaff(toDepositRefundOutcome({ refunded: false, reason: 'zero_tier' }))?.message)
      .toBe('No deposit refund is due: the booking was cancelled inside its 3-day refund cutoff.')
  })

  it('says nothing for a booking that took no deposit', () => {
    expect(describeDepositRefundForStaff(toDepositRefundOutcome({ refunded: false, reason: 'no_deposit' }))).toBeNull()
  })

  it('reads the outcome back from a route payload, and ignores anything else', () => {
    expect(readDepositRefundOutcome({ state: 'owed', amount_pence: 4000 })).toEqual({ state: 'owed', amount_pence: 4000, cutoff_days: null })
    expect(readDepositRefundOutcome({ state: 'something_else' })).toBeNull()
    expect(readDepositRefundOutcome(null)).toBeNull()
  })
})

describe('the cancel routes and screens carry the deposit outcome through', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

  it.each([
    'src/app/api/foh/bookings/[id]/cancel/route.ts',
    'src/app/api/boh/table-bookings/[id]/route.ts',
    'src/app/api/boh/table-bookings/[id]/status/route.ts',
  ])('%s returns deposit_refund from the cancellation', (path) => {
    const source = read(path)
    expect(source).toContain('depositRefund = toDepositRefundOutcome(cancelOutcome?.refundResult)')
    expect(source).toContain('deposit_refund: depositRefund')
  })

  it.each([
    'src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx',
    'src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx',
  ])('%s shows it to the person who cancelled', (path) => {
    expect(read(path)).toContain('describeDepositRefundForStaff(readDepositRefundOutcome(')
  })
})
