// changeParkingBookingDates: the order of the save, the money and the text (spec
// tasks/spec-2026-11-24-parking-change-time-and-settle.md, section 6.2).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/current-user', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/parking/repository', () => ({
  getActiveParkingRate: vi.fn(),
  getParkingBooking: vi.fn(),
  updateParkingBooking: vi.fn(),
}))
vi.mock('@/lib/parking/payments', () => ({
  createParkingPaymentOrder: vi.fn(),
  sendParkingPaymentRequest: vi.fn(),
}))
vi.mock('@/services/parking', () => ({ createPendingParkingBooking: vi.fn() }))
vi.mock('@/lib/parking/change-settlement', () => ({
  refundParkingBooking: vi.fn(),
  sendParkingChangeText: vi.fn(),
}))
vi.mock('@/lib/parking/balance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/parking/balance')>()
  return { ...actual, loadParkingMoneyRows: vi.fn() }
})

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/supabase/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveParkingRate, getParkingBooking } from '@/lib/parking/repository'
import { createParkingPaymentOrder, sendParkingPaymentRequest } from '@/lib/parking/payments'
import { refundParkingBooking, sendParkingChangeText } from '@/lib/parking/change-settlement'
import { loadParkingMoneyRows } from '@/lib/parking/balance'
import { logAuditEvent } from '@/app/actions/audit'
import { changeParkingBookingDates } from '@/app/actions/parking'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedUser = getCurrentUser as unknown as Mock
const mockedAdmin = createAdminClient as unknown as Mock
const mockedRate = getActiveParkingRate as unknown as Mock
const mockedBooking = getParkingBooking as unknown as Mock
const mockedOrder = createParkingPaymentOrder as unknown as Mock
const mockedPaymentRequest = sendParkingPaymentRequest as unknown as Mock
const mockedRefund = refundParkingBooking as unknown as Mock
const mockedText = sendParkingChangeText as unknown as Mock
const mockedMoney = loadParkingMoneyRows as unknown as Mock

const CHANGE_ID = '11111111-1111-4111-8111-111111111111'
const UPDATED_AT = '2026-11-24T09:00:00.000000+00:00'

// Far enough ahead that the 24-hour rule never applies, whatever day the suite runs.
const START = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
START.setUTCHours(10, 0, 0, 0)
const at = (days: number) => new Date(START.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

function paidBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    reference: 'PAR-TEST-0001',
    status: 'confirmed',
    payment_status: 'paid',
    start_at: at(0),
    end_at: at(9),
    calculated_price: 105,
    override_price: null,
    override_reason: null,
    updated_at: UPDATED_AT,
    customer_id: 'customer-1',
    customer_first_name: 'Leon',
    customer_mobile: '+447700900123',
    payment_due_at: null,
    ...overrides,
  }
}

interface FakeDb {
  earlierMarker: { id: string } | null
  saveResult: { data: unknown; error: unknown }
  updates: Array<{ table: string; values: Record<string, unknown> }>
  inserts: Array<{ table: string; values: Record<string, unknown> }>
}

function fakeAdmin(db: FakeDb) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      let mode: 'select' | 'update' | 'insert' = 'select'
      const self = () => chain
      Object.assign(chain, {
        select: () => chain,
        eq: self,
        contains: self,
        limit: self,
        order: self,
        in: self,
        update: (values: Record<string, unknown>) => {
          mode = 'update'
          db.updates.push({ table, values })
          return chain
        },
        insert: (values: Record<string, unknown>) => {
          mode = 'insert'
          db.inserts.push({ table, values })
          return chain
        },
        maybeSingle: async () => {
          if (table === 'parking_bookings' && mode === 'update') return db.saveResult
          if (table === 'parking_booking_notifications' && mode === 'select') return { data: db.earlierMarker, error: null }
          return { data: null, error: null }
        },
        single: async () => ({ data: { id: 'marker-1' }, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
      })
      return chain
    },
  }
}

let db: FakeDb

function input(overrides: Record<string, unknown> = {}) {
  return {
    changeId: CHANGE_ID,
    expectedUpdatedAt: UPDATED_AT,
    start_at: at(0),
    end_at: at(4),
    expectedNewPrice: 60,
    notifyCustomer: true,
    sendPaymentLink: true,
    refundAmount: 45,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUser.mockResolvedValue({ user: { id: 'user-1' } })
  mockedPermission.mockResolvedValue(true)
  mockedRate.mockResolvedValue({ hourly_rate: 5, daily_rate: 15, weekly_rate: 75, monthly_rate: 265 })
  mockedBooking.mockResolvedValue(paidBooking())
  mockedMoney.mockResolvedValue({
    payments: [
      {
        id: 'pay-1',
        status: 'paid',
        amount: 105,
        provider: 'paypal',
        transaction_id: 'CAP-1',
        paid_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
    refunds: [],
  })
  mockedRefund.mockResolvedValue({ refunded: 45, viaPayPal: true, refundedViaPayPal: 45, complete: true, failures: [] })
  mockedText.mockResolvedValue({ status: 'sent', note: null, body: 'text' })
  db = {
    earlierMarker: null,
    saveResult: { data: { ...paidBooking({ end_at: at(4), calculated_price: 60 }) }, error: null },
    updates: [],
    inserts: [],
  }
  mockedAdmin.mockReturnValue(fakeAdmin(db))
})

describe('changeParkingBookingDates', () => {
  it('shortening a paid stay saves first, refunds the difference, then sends one change text naming it', async () => {
    const result = await changeParkingBookingDates('booking-1', input())

    expect(result).toMatchObject({ success: true, refunded: 45, textStatus: 'sent' })
    expect(result.warning).toBeUndefined()

    const [save, finalPrice] = db.updates.filter((u) => u.table === 'parking_bookings')
    // Held at what was paid while the refund goes, so nobody can send the same difference again...
    expect(save?.values).toMatchObject({ end_at: at(4), calculated_price: 60, override_price: 105, override_reason: 'Refund in progress' })
    // ...then the calculated price once it has gone.
    expect(finalPrice?.values).toEqual({ override_price: null, override_reason: null })
    expect(db.inserts[0]).toMatchObject({
      table: 'parking_booking_notifications',
      values: { event_type: 'booking_changed', payload: expect.objectContaining({ change_id: CHANGE_ID }) },
    })

    expect(mockedRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 45, operationId: CHANGE_ID, skipCustomerNotification: true })
    )
    expect(mockedText).toHaveBeenCalledTimes(1)
    expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'refund', amount: 45 })
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ additional_info: expect.objectContaining({ action: 'change_parking_dates', refunded: 45 }) })
    )
  })

  it('a capacity refusal moves no money and sends no text', async () => {
    db.saveResult = { data: null, error: { message: 'No parking spaces remaining for the selected period' } }

    const result = await changeParkingBookingDates('booking-1', input({ end_at: at(4) }))

    expect(result.error).toMatch(/No parking spaces are free/)
    expect(mockedRefund).not.toHaveBeenCalled()
    expect(mockedText).not.toHaveBeenCalled()
    expect(db.inserts).toHaveLength(0)
  })

  it('refuses a booking changed since the dialog opened, before saving anything', async () => {
    const result = await changeParkingBookingDates('booking-1', input({ expectedUpdatedAt: '2026-11-23T09:00:00.000000+00:00' }))

    expect(result.error).toMatch(/has changed since you opened/)
    expect(db.updates).toHaveLength(0)
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('refuses when someone else saved in between (the updated_at guard matches no row)', async () => {
    db.saveResult = { data: null, error: null }

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result.error).toMatch(/has changed since you opened/)
    expect(mockedRefund).not.toHaveBeenCalled()
    expect(mockedText).not.toHaveBeenCalled()
  })

  it('the same change submitted twice saves, refunds and texts once', async () => {
    db.earlierMarker = { id: 'marker-1' }

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result).toMatchObject({ success: true, alreadyApplied: true })
    expect(db.updates).toHaveLength(0)
    expect(mockedRefund).not.toHaveBeenCalled()
    expect(mockedText).not.toHaveBeenCalled()
  })

  it('refuses when the server price differs from the one on screen', async () => {
    const result = await changeParkingBookingDates('booking-1', input({ expectedNewPrice: 55 }))

    expect(result.error).toMatch(/The new price is now £60.00/)
    expect(db.updates).toHaveLength(0)
  })

  it('a refund that fails keeps the change, warns, and sends the plain text with no refund promised', async () => {
    mockedRefund.mockResolvedValue({ refunded: 0, viaPayPal: false, refundedViaPayPal: 0, complete: false, failures: ['PayPal said no.'] })

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result.success).toBe(true)
    expect(result.warning).toMatch(/the £45.00 refund did not go through/)
    // The price ends at £60 against £105 still paid, so the booking shows £45 as a refund to do.
    expect(db.updates.filter((u) => u.table === 'parking_bookings').at(-1)?.values).toEqual({ override_price: null, override_reason: null })
    expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'plain' })
  })

  it('a manual refund (no PayPal) is not described to the customer as going back to the way they paid', async () => {
    mockedRefund.mockResolvedValue({ refunded: 45, viaPayPal: false, refundedViaPayPal: 0, complete: true, failures: [] })

    await changeParkingBookingDates('booking-1', input())

    expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'plain' })
  })

  it.each([
    ['failed', 'Texts are switched off at the moment, so the customer was not told.'],
    ['skipped', 'The customer has opted out of texts, so they were not told.'],
  ])('a %s text keeps the change and says so', async (status, note) => {
    mockedText.mockResolvedValue({ status, note, body: 'text' })

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result.success).toBe(true)
    expect(result.warning).toContain(note)
  })

  it('a text held for quiet hours is not a warning', async () => {
    mockedText.mockResolvedValue({ status: 'held', note: 'It is quiet hours, so the text will go at 09:00.', body: 'text' })

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result).toMatchObject({ success: true, textStatus: 'held' })
    expect(result.warning).toBeUndefined()
  })

  it('refunding less than the difference needs a reason, and keeps the rest as the agreed price', async () => {
    const refused = await changeParkingBookingDates('booking-1', input({ refundAmount: 20 }))
    expect(refused.error).toBe('Give a reason for refunding less than the difference.')

    mockedRefund.mockResolvedValue({ refunded: 20, viaPayPal: true, refundedViaPayPal: 20, complete: true, failures: [] })
    const result = await changeParkingBookingDates('booking-1', input({ refundAmount: 20, refundReason: 'Late notice' }))

    expect(result.success).toBe(true)
    const finalPrice = db.updates.filter((u) => u.table === 'parking_bookings').at(-1)
    expect(finalPrice?.values.override_price).toBe(85)
    expect(String(finalPrice?.values.override_reason)).toContain('£25.00 of the difference kept: Late notice')
  })

  it('without refund permission the change saves, no money moves, and it says a manager must refund', async () => {
    mockedPermission.mockImplementation(async (_module: string, action: string) => action !== 'refund')

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result.success).toBe(true)
    expect(mockedRefund).not.toHaveBeenCalled()
    expect(result.warning).toMatch(/A manager will need to send the refund of up to £45.00/)
    expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'plain' })
  })

  describe('a paid booking that now costs more (D4)', () => {
    const longer = (overrides: Record<string, unknown> = {}) =>
      input({ end_at: at(14), expectedNewPrice: 150, refundAmount: undefined, expectedExtra: 45, ...overrides })

    beforeEach(() => {
      db.saveResult = { data: paidBooking({ end_at: at(14), calculated_price: 150 }), error: null }
    })

    it('needs a choice, and nothing is saved without one', async () => {
      const result = await changeParkingBookingDates('booking-1', longer({ extraChoice: undefined }))
      expect(result.error).toMatch(/costs £45.00 more. Choose how the extra is settled/)
      expect(db.updates).toHaveLength(0)
    })

    it('refuses when the extra has changed since the dialog loaded', async () => {
      const result = await changeParkingBookingDates('booking-1', longer({ extraChoice: 'link', expectedExtra: 30 }))
      expect(result.error).toMatch(/The extra to pay is now £45.00, not £30.00/)
      expect(db.updates).toHaveLength(0)
    })

    it('text a payment link: an order for the extra only, named in the one change text', async () => {
      mockedOrder.mockResolvedValue({ approveUrl: 'https://paypal.example/topup' })

      const result = await changeParkingBookingDates('booking-1', longer({ extraChoice: 'link' }))

      expect(result).toMatchObject({ success: true, paymentLink: 'https://paypal.example/topup' })
      expect(result.warning).toBeUndefined()
      expect(mockedOrder.mock.calls[0][1]).toMatchObject({ amount: 45, purpose: 'top_up' })
      expect(mockedText).toHaveBeenCalledTimes(1)
      expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'pay_link', amount: 45, link: 'https://paypal.example/topup' })
      // Saved at the calculated price: the extra shows as to pay until the link is paid.
      const save = db.updates.find((update) => update.table === 'parking_bookings')
      expect(save?.values).toMatchObject({ calculated_price: 150, override_price: null })
      expect(save?.values).not.toHaveProperty('status')
      expect(save?.values).not.toHaveProperty('payment_status')
    })

    it('a link that cannot be made leaves the change saved, with a warning and a plain text', async () => {
      mockedOrder.mockRejectedValue(new Error('PayPal is down'))

      const result = await changeParkingBookingDates('booking-1', longer({ extraChoice: 'link' }))

      expect(result.success).toBe(true)
      expect(result.warning).toMatch(/a payment link for the £45.00 extra could not be made/)
      expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'plain' })
    })

    it('paid at the venue: a manual payment row for the extra and the thank-you text', async () => {
      const result = await changeParkingBookingDates('booking-1', longer({ extraChoice: 'venue', venueMethod: 'card_terminal' }))

      expect(result.success).toBe(true)
      expect(mockedOrder).not.toHaveBeenCalled()
      const row = db.inserts.find((insert) => insert.table === 'parking_booking_payments')
      expect(row?.values).toMatchObject({ provider: 'manual', status: 'paid', amount: 45 })
      expect(row?.values.metadata).toMatchObject({ method: 'card_terminal', purpose: 'top_up', change_id: CHANGE_ID })
      expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'paid_at_venue', amount: 45 })
    })

    it('no extra charge needs a reason', async () => {
      const result = await changeParkingBookingDates('booking-1', longer({ extraChoice: 'waive' }))
      expect(result.error).toMatch(/Give a reason/)
      expect(db.updates).toHaveLength(0)
    })

    it('no extra charge: the price becomes what has been paid, and no money moves', async () => {
      const result = await changeParkingBookingDates('booking-1', longer({ extraChoice: 'waive', waiveReason: 'Flight delayed' }))

      expect(result.success).toBe(true)
      const save = db.updates.find((update) => update.table === 'parking_bookings')
      expect(save?.values).toMatchObject({ override_price: 105 })
      expect(String(save?.values.override_reason)).toContain('Flight delayed')
      expect(mockedOrder).not.toHaveBeenCalled()
      expect(db.inserts.filter((insert) => insert.table === 'parking_booking_payments')).toHaveLength(0)
      expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'plain' })
    })
  })

  it('a refund split between PayPal and cash names only the PayPal part in the text', async () => {
    mockedRefund.mockResolvedValue({ refunded: 45, viaPayPal: true, refundedViaPayPal: 30, complete: true, failures: [] })

    await changeParkingBookingDates('booking-1', input())

    expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'refund', amount: 30 })
  })

  it('an unpaid booking gets a new payment link and the payment text instead of the change text', async () => {
    mockedBooking.mockResolvedValue(paidBooking({ status: 'pending_payment', payment_status: 'pending' }))
    mockedMoney.mockResolvedValue({
      payments: [{ id: 'pay-old', status: 'pending', amount: 105, created_at: new Date().toISOString(), metadata: {} }],
      refunds: [],
    })
    db.saveResult = { data: paidBooking({ status: 'pending_payment', payment_status: 'pending', end_at: at(4), calculated_price: 60 }), error: null }
    mockedOrder.mockResolvedValue({ approveUrl: 'https://paypal.example/approve' })
    mockedPaymentRequest.mockResolvedValue({ sent: true })

    const result = await changeParkingBookingDates('booking-1', input({ refundAmount: undefined }))

    expect(result).toMatchObject({ success: true, paymentLink: 'https://paypal.example/approve', textStatus: 'sent' })
    expect(db.updates.find((u) => u.table === 'parking_booking_payments')?.values).toMatchObject({ status: 'expired' })
    expect(mockedPaymentRequest).toHaveBeenCalledWith(expect.anything(), 'https://paypal.example/approve', expect.anything())
    expect(mockedText).not.toHaveBeenCalled()
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('an unpaid booking whose link cannot be made still changes, and warns', async () => {
    mockedBooking.mockResolvedValue(paidBooking({ status: 'pending_payment', payment_status: 'pending' }))
    mockedMoney.mockResolvedValue({ payments: [], refunds: [] })
    db.saveResult = { data: paidBooking({ status: 'pending_payment', payment_status: 'pending', end_at: at(4), calculated_price: 60 }), error: null }
    mockedOrder.mockRejectedValue(new Error('PayPal down'))

    const result = await changeParkingBookingDates('booking-1', input({ refundAmount: undefined }))

    expect(result.success).toBe(true)
    expect(result.warning).toMatch(/a new payment link could not be made/)
    expect(mockedPaymentRequest).not.toHaveBeenCalled()
  })

  it('needs parking manage', async () => {
    mockedPermission.mockResolvedValue(false)

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result.error).toBe('You do not have permission to change parking bookings')
    expect(db.updates).toHaveLength(0)
  })
})

describe('settleParkingRefundDue', () => {
  // £105 paid for a stay now priced £60: £45 to refund.
  beforeEach(() => {
    mockedBooking.mockResolvedValue(paidBooking({ end_at: at(4), calculated_price: 60 }))
  })

  it('claims the booking (price held at what was paid) before any money moves, then sets the final price', async () => {
    db.saveResult = { data: { id: 'booking-1' }, error: null }
    const { settleParkingRefundDue } = await import('@/app/actions/parking')

    const result = await settleParkingRefundDue('booking-1', { operationId: CHANGE_ID, amount: 45, reason: 'Shortened' })

    expect(result).toMatchObject({ success: true, refunded: 45 })
    const [claim, finalPrice] = db.updates.filter((u) => u.table === 'parking_bookings')
    expect(claim.values).toMatchObject({ override_price: 105, override_reason: 'Refund in progress' })
    expect(finalPrice.values).toEqual({ override_price: null, override_reason: null })
    expect(mockedRefund).toHaveBeenCalledWith(expect.objectContaining({ amount: 45, operationId: CHANGE_ID }))
  })

  it('sends nothing when someone else settled it first (the claim matches no row)', async () => {
    db.saveResult = { data: null, error: null }
    const { settleParkingRefundDue } = await import('@/app/actions/parking')

    const result = await settleParkingRefundDue('booking-1', { operationId: CHANGE_ID, amount: 45, reason: 'Shortened' })

    expect(result.error).toMatch(/has just changed/)
    expect(mockedRefund).not.toHaveBeenCalled()
  })

  it('records no refund due as a kept price, with no money moved', async () => {
    db.saveResult = { data: { id: 'booking-1' }, error: null }
    const { settleParkingRefundDue } = await import('@/app/actions/parking')

    const result = await settleParkingRefundDue('booking-1', { operationId: CHANGE_ID, noRefund: true, reason: 'Arrived late' })

    expect(result.success).toBe(true)
    expect(mockedRefund).not.toHaveBeenCalled()
    expect(db.updates.find((u) => u.table === 'parking_bookings')?.values).toMatchObject({ override_price: 105 })
  })
})
