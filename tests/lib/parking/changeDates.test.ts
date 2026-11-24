// Changing a parking booking's dates: the money rules (spec
// tasks/spec-2026-11-24-parking-change-time-and-settle.md, sections 3, 5, 6.2, 8 and 13).

import { describe, expect, it } from 'vitest'
import {
  allocateRefund,
  computeParkingBalance,
  parkingBalanceLabel,
  refundablePayments,
  type ParkingBalancePaymentRow,
  type ParkingBalanceRefundRow,
} from '@/lib/parking/balance'
import { changeRefundKey, planParkingDateChange, reminderFlagResets, type ParkingChangeBooking } from '@/lib/parking/change-dates'
import { calculateParkingPricing, type ParkingRateConfig } from '@/lib/parking/pricing'
import { buildBookingChangedSms, buildTopUpReceivedSms } from '@/lib/parking/notifications'

// The live rate since 3 October 2025.
const RATES: ParkingRateConfig = { hourlyRate: 5, dailyRate: 15, weeklyRate: 75, monthlyRate: 265 }
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function paidRow(overrides: Partial<ParkingBalancePaymentRow> = {}): ParkingBalancePaymentRow {
  return {
    id: 'pay-1',
    status: 'paid',
    amount: 75,
    provider: 'paypal',
    transaction_id: 'CAP-1',
    paid_at: '2026-11-20T10:00:00.000Z',
    created_at: '2026-11-20T10:00:00.000Z',
    ...overrides,
  }
}

const confirmed = { status: 'confirmed' as const, payment_status: 'paid' as const, override_price: null }

describe('the balance (section 5)', () => {
  it('an unpaid booking has no balance: it owes its whole price under the old model', () => {
    const balance = computeParkingBalance(
      { status: 'pending_payment', payment_status: 'pending', calculated_price: 60, override_price: null },
      [],
      []
    )
    expect(balance).toMatchObject({ price: 60, balance: 0, state: 'none' })
  })

  it('paid in full is settled', () => {
    expect(computeParkingBalance({ ...confirmed, calculated_price: 75 }, [paidRow()], [])).toMatchObject({
      paid: 75,
      netPaid: 75,
      balance: 0,
      state: 'settled',
    })
  })

  it('a part refund leaves money to collect again', () => {
    const refunds: ParkingBalanceRefundRow[] = [{ source_id: 'pay-1', amount: 15, status: 'completed' }]
    expect(computeParkingBalance({ ...confirmed, calculated_price: 75 }, [paidRow()], refunds)).toMatchObject({
      refunded: 15,
      netPaid: 60,
      balance: 15,
      state: 'to_pay',
    })
  })

  it('counts a pending refund as gone, and ignores a failed one', () => {
    const refunds: ParkingBalanceRefundRow[] = [
      { source_id: 'pay-1', amount: 45, status: 'pending' },
      { source_id: 'pay-1', amount: 45, status: 'failed' },
    ]
    expect(computeParkingBalance({ ...confirmed, calculated_price: 60 }, [paidRow({ amount: 105 })], refunds)).toMatchObject({
      refunded: 45,
      balance: 0,
      state: 'settled',
    })
  })

  it('adds two payments together', () => {
    const payments = [paidRow(), paidRow({ id: 'pay-2', amount: 30, created_at: '2026-11-22T10:00:00.000Z' })]
    expect(computeParkingBalance({ ...confirmed, calculated_price: 105 }, payments, [])).toMatchObject({ paid: 105, state: 'settled' })
  })

  it('an overpaid booking shows a refund to do', () => {
    const balance = computeParkingBalance({ ...confirmed, calculated_price: 60 }, [paidRow({ amount: 105 })], [])
    expect(balance).toMatchObject({ balance: -45, state: 'refund_due' })
    expect(parkingBalanceLabel(balance)).toBe('£45.00 refund to do')
  })

  it('a part refund reads as money to pay', () => {
    expect(parkingBalanceLabel({ state: 'to_pay', balance: 15 })).toBe('£15.00 to pay')
  })

  it('uses the agreed price over the calculated one', () => {
    expect(
      computeParkingBalance({ ...confirmed, calculated_price: 60, override_price: 105 }, [paidRow({ amount: 105 })], [])
    ).toMatchObject({ price: 105, state: 'settled' })
  })

  it('ignores pending and expired payment rows', () => {
    const payments = [
      paidRow(),
      paidRow({ id: 'pay-2', status: 'pending', amount: 30 }),
      paidRow({ id: 'pay-3', status: 'expired', amount: 30 }),
    ]
    expect(computeParkingBalance({ ...confirmed, calculated_price: 105 }, payments, [])).toMatchObject({ paid: 75, balance: 30 })
  })

  it('a cancelled, fully refunded booking shows no balance', () => {
    const balance = computeParkingBalance(
      { status: 'cancelled', payment_status: 'refunded', calculated_price: 75, override_price: null },
      [paidRow()],
      [{ source_id: 'pay-1', amount: 75, status: 'completed' }]
    )
    expect(balance.state).toBe('none')
    expect(parkingBalanceLabel(balance)).toBeNull()
  })

  it('takes a refund off the newest payment first, each capped at what is left on it', () => {
    const payments = refundablePayments(
      [paidRow(), paidRow({ id: 'pay-2', amount: 30, created_at: '2026-11-22T10:00:00.000Z' })],
      [{ source_id: 'pay-2', amount: 10, status: 'completed' }]
    )
    const { allocations, unallocated } = allocateRefund(40, payments)
    expect(allocations.map((a) => [a.payment.id, a.amount])).toEqual([
      ['pay-2', 20],
      ['pay-1', 20],
    ])
    expect(unallocated).toBe(0)
    expect(allocateRefund(200, payments).unallocated).toBe(105)
  })
})

describe('the worked prices (section 13), through the real pricing', () => {
  const start = new Date('2026-12-01T10:00:00.000Z')
  it.each([
    ['4 days', 4 * DAY, 60],
    ['5 days', 5 * DAY, 75],
    ['6 days', 6 * DAY, 75],
    ['7 days', 7 * DAY, 75],
    ['7 days 3 hours', 7 * DAY + 3 * HOUR, 90],
    ['9 days', 9 * DAY, 105],
  ])('%s costs £%#', (_label, length, price) => {
    expect(calculateParkingPricing(start, new Date(start.getTime() + length), RATES).total).toBe(price)
  })

  it('prices a stay across the clock change the same in any server zone', () => {
    // 27 to 29 March 2027: the clocks go forward on the 28th; this is 47 real hours.
    const pricing = calculateParkingPricing(new Date('2027-03-27T10:00:00.000Z'), new Date('2027-03-29T09:00:00.000Z'), RATES)
    expect(pricing.durationMinutes).toBe(47 * 60)
    expect(pricing.total).toBe(30)
  })
})

function booking(overrides: Partial<ParkingChangeBooking> = {}): ParkingChangeBooking {
  return {
    id: 'booking-1',
    status: 'confirmed',
    payment_status: 'paid',
    start_at: '2026-12-10T10:00:00.000Z',
    end_at: '2026-12-19T10:00:00.000Z',
    calculated_price: 105,
    override_price: null,
    override_reason: null,
    updated_at: '2026-11-24T09:00:00.000000+00:00',
    ...overrides,
  } as ParkingChangeBooking
}

const NOW = new Date('2026-11-24T12:00:00.000Z')

function plan(input: {
  booking?: Partial<ParkingChangeBooking>
  start?: string
  end: string
  payments?: ParkingBalancePaymentRow[]
  now?: Date
}) {
  const b = booking(input.booking)
  return planParkingDateChange({
    booking: b,
    payments: input.payments ?? [paidRow({ amount: 105 })],
    refunds: [],
    newStartAt: input.start ?? b.start_at,
    newEndAt: input.end,
    rates: RATES,
    now: input.now ?? NOW,
  })
}

describe('planning a change (sections 3 and 6.2)', () => {
  it('example B: shortening 9 days to 4 a fortnight ahead offers the £45 difference back', () => {
    expect(plan({ end: '2026-12-14T10:00:00.000Z' })).toMatchObject({
      ok: true,
      plan: { oldPrice: 105, newPrice: 60, kind: 'refund', refundDue: 45, refundDefault: 45 },
    })
  })

  it('the weekly trap: 7 days to 5 costs the same, so there is nothing to settle', () => {
    expect(
      plan({
        booking: { end_at: '2026-12-17T10:00:00.000Z', calculated_price: 75 },
        payments: [paidRow({ amount: 75 })],
        end: '2026-12-15T10:00:00.000Z',
      })
    ).toMatchObject({ ok: true, plan: { kind: 'none', refundDue: 0 } })
  })

  it('inside 24 hours of arrival the refund starts at £0 but can go up to the difference (D3)', () => {
    expect(plan({ end: '2026-12-14T10:00:00.000Z', now: new Date('2026-12-09T12:00:00.000Z') })).toMatchObject({
      ok: true,
      plan: { insideNoRefundWindow: true, refundDue: 45, refundDefault: 0 },
    })
  })

  it('example A: extending a paid stay under way shows the extra owed', () => {
    expect(
      plan({
        booking: { start_at: '2026-11-20T10:00:00.000Z', end_at: '2026-11-27T10:00:00.000Z', calculated_price: 75 },
        payments: [paidRow()],
        end: '2026-11-29T10:00:00.000Z',
      })
    ).toMatchObject({ ok: true, plan: { newPrice: 105, kind: 'extra', extraDue: 30, started: true } })
  })

  it('an unpaid booking owes its new price', () => {
    expect(
      plan({ booking: { status: 'pending_payment', payment_status: 'pending' }, payments: [], end: '2026-12-14T10:00:00.000Z' })
    ).toMatchObject({ ok: true, plan: { kind: 'unpaid', balanceAfter: 60 } })
  })

  it('a date change starts from the calculated price, not an old agreed one', () => {
    expect(plan({ booking: { override_price: 90 }, end: '2026-12-14T10:00:00.000Z' })).toMatchObject({
      ok: true,
      plan: { oldPrice: 90, newPrice: 60, hadOverride: true },
    })
  })

  it('a PayPal payment older than 180 days cannot be refunded through PayPal', () => {
    const result = plan({
      payments: [paidRow({ amount: 105, paid_at: '2026-04-01T10:00:00.000Z' })],
      end: '2026-12-14T10:00:00.000Z',
    })
    expect(result).toMatchObject({ ok: true, plan: { paypalRefundPossible: false } })
  })

  it.each(['cancelled', 'completed', 'expired'] as const)('refuses a %s booking', (status) => {
    expect(plan({ booking: { status }, end: '2026-12-14T10:00:00.000Z' })).toMatchObject({ ok: false })
  })

  it('refuses an end that is not after the start', () => {
    expect(plan({ end: '2026-12-10T10:00:00.000Z' })).toEqual({ ok: false, error: 'The end must be after the start.' })
  })

  it('refuses no change at all', () => {
    expect(plan({ end: '2026-12-19T10:00:00.000Z' })).toMatchObject({ ok: false })
  })

  it('refuses moving the start of a stay that has started', () => {
    expect(
      plan({
        booking: { start_at: '2026-11-20T10:00:00.000Z', end_at: '2026-11-27T10:00:00.000Z' },
        start: '2026-11-21T10:00:00.000Z',
        end: '2026-11-27T10:00:00.000Z',
      })
    ).toEqual({ ok: false, error: 'This stay has started, so only the end can move.' })
  })

  describe('a stay whose end has passed (D10)', () => {
    const ended = { start_at: '2026-11-10T10:00:00.000Z', end_at: '2026-11-17T10:00:00.000Z', calculated_price: 75 }
    it('can be extended within 7 days of its booked end', () => {
      expect(plan({ booking: ended, payments: [paidRow()], end: '2026-11-19T10:00:00.000Z' })).toMatchObject({
        ok: true,
        plan: { ended: true, kind: 'extra' },
      })
    })
    it('cannot be extended further than that', () => {
      expect(plan({ booking: ended, payments: [paidRow()], end: '2026-11-25T10:00:00.000Z' })).toMatchObject({ ok: false })
    })
    it('cannot be shortened', () => {
      expect(plan({ booking: ended, payments: [paidRow()], end: '2026-11-16T10:00:00.000Z' })).toMatchObject({ ok: false })
    })
  })
})

describe('reminder flags (section 8.2)', () => {
  it('clears a flag only for the end that moved, and only when it is more than three days away', () => {
    expect(
      reminderFlagResets({
        startMoved: true,
        endMoved: true,
        newStartAt: '2026-12-10T10:00:00.000Z',
        newEndAt: '2026-11-26T10:00:00.000Z',
        now: NOW,
      })
    ).toEqual({ resetStart: true, resetEnd: false })
    expect(
      reminderFlagResets({
        startMoved: false,
        endMoved: true,
        newStartAt: '2026-12-10T10:00:00.000Z',
        newEndAt: '2026-12-20T10:00:00.000Z',
        now: NOW,
      })
    ).toEqual({ resetStart: false, resetEnd: true })
  })
})

describe('the refund key', () => {
  it('is a stable UUID per change and payment', () => {
    const changeId = '11111111-1111-4111-8111-111111111111'
    const key = changeRefundKey(changeId, 'pay-1')
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(changeRefundKey(changeId, 'pay-1')).toBe(key)
    expect(changeRefundKey(changeId, 'pay-2')).not.toBe(key)
  })
})

describe('the change texts (section 8.1, approved 24 November 2026)', () => {
  const textBooking = {
    id: 'booking-1',
    reference: 'PAR-20261124-0001',
    customer_id: null,
    customer_first_name: 'Leon',
    customer_last_name: 'Smith',
    customer_mobile: '+447700900123',
    customer_email: null,
    vehicle_registration: 'AB12CDE',
    start_at: '2026-12-10T10:00:00.000Z',
    end_at: '2026-12-14T10:00:00.000Z',
    calculated_price: 60,
    override_price: null,
  } as Parameters<typeof buildBookingChangedSms>[0]

  const texts: Array<[string, string]> = [
    ['plain', buildBookingChangedSms(textBooking, { kind: 'plain' })],
    ['refund', buildBookingChangedSms(textBooking, { kind: 'refund', amount: 45 })],
    ['pay link', buildBookingChangedSms(textBooking, { kind: 'pay_link', amount: 30, link: 'https://l.the-anchor.pub/abc123' })],
    ['paid at venue', buildBookingChangedSms(textBooking, { kind: 'paid_at_venue', amount: 30 })],
    ['top-up received', buildTopUpReceivedSms(textBooking, 30)],
  ]

  // Curly quotes and long dashes knock a text out of GSM-7 and double its cost.
  const nonGsm = new RegExp(`[${[0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014].map((c) => String.fromCharCode(c)).join('')}]`)

  it.each(texts)('the %s text renders cleanly', (_name, text) => {
    expect(text).not.toMatch(/undefined|Invalid Date|NaN|£0\.00|null/)
    expect(text).toMatch(/^The Anchor: Hi Leon, /)
    expect(text).not.toMatch(nonGsm)
  })

  it('names both London times and the amount', () => {
    const refund = texts[1][1]
    expect(refund).toContain('10:00')
    expect(refund).toContain('£45.00')
    expect(refund).toContain('We are refunding £45.00 to the way you paid.')
    expect(texts[2][1]).toContain('There is £30.00 extra to pay: https://l.the-anchor.pub/abc123.')
  })

  it('shows BST times an hour on from UTC in summer', () => {
    const summer = buildBookingChangedSms(
      { ...textBooking, start_at: '2027-06-10T09:00:00.000Z', end_at: '2027-06-12T09:00:00.000Z' },
      { kind: 'plain' }
    )
    expect(summer).toContain('10:00')
    expect(summer).not.toContain('09:00')
  })
})
