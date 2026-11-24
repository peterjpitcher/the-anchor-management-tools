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
  mockedRefund.mockResolvedValue({ refunded: 45, viaPayPal: true, complete: true, failures: [] })
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

    const save = db.updates.find((u) => u.table === 'parking_bookings')
    expect(save?.values).toMatchObject({ end_at: at(4), calculated_price: 60, override_price: null })
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
    mockedRefund.mockResolvedValue({ refunded: 0, viaPayPal: false, complete: false, failures: ['PayPal said no.'] })

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result.success).toBe(true)
    expect(result.warning).toMatch(/the £45.00 refund did not go through/)
    expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'plain' })
  })

  it('a manual refund (no PayPal) is not described to the customer as going back to the way they paid', async () => {
    mockedRefund.mockResolvedValue({ refunded: 45, viaPayPal: false, complete: true, failures: [] })

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

    mockedRefund.mockResolvedValue({ refunded: 20, viaPayPal: true, complete: true, failures: [] })
    const result = await changeParkingBookingDates('booking-1', input({ refundAmount: 20, refundReason: 'Late notice' }))

    expect(result.success).toBe(true)
    const save = db.updates.find((u) => u.table === 'parking_bookings')
    expect(save?.values).toMatchObject({ override_price: 85 })
    expect(String(save?.values.override_reason)).toContain('£25.00 of the difference kept: Late notice')
  })

  it('without refund permission the change saves, no money moves, and it says a manager must refund', async () => {
    mockedPermission.mockImplementation(async (_module: string, action: string) => action !== 'refund')

    const result = await changeParkingBookingDates('booking-1', input())

    expect(result.success).toBe(true)
    expect(mockedRefund).not.toHaveBeenCalled()
    expect(result.warning).toMatch(/A manager will need to send the refund of up to £45.00/)
    expect(mockedText.mock.calls[0][0].outcome).toEqual({ kind: 'plain' })
  })

  it('a paid booking that would cost more is refused for now', async () => {
    const result = await changeParkingBookingDates('booking-1', input({ end_at: at(14), expectedNewPrice: 150 }))

    expect(result.error).toMatch(/This change costs £45.00 more. Extending a paid booking is not available yet./)
    expect(db.updates).toHaveLength(0)
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
