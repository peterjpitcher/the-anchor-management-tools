import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-065 (customer bookings review, 24 October 2026): a cancellation told the guest "we'll refund
 * £X within 10 working days" but recorded nothing owed, left the booking's invoice payable, and
 * could be made from the edit form with none of the money work. Owner decision D26: costs already
 * committed may be kept back from the refund, with a reason.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => state.db) }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))
vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true, channel: 'email' })),
}))
vi.mock('@/lib/money-alerts', () => ({
  alertMoneyNeedsAPerson: vi.fn(async () => ({ sent: true, duplicate: false })),
  formatPounds: (amount: number) => `£${amount.toFixed(2)}`,
}))
vi.mock('@/services/private-bookings/financial', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/private-bookings/financial')>()),
  getPrivateBookingCancellationOutcome: vi.fn(),
}))

import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import { getPrivateBookingCancellationOutcome } from '@/services/private-bookings/financial'
import { PrivateBookingService } from '@/services/private-bookings'

// 16:00 in London on Tuesday 27 October 2026.
const NOW = new Date('2026-10-27T16:00:00.000Z')

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'confirmed',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: 'host@example.com',
    event_type: 'Birthday party',
    event_date: '2026-12-12',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    calendar_event_id: null,
    invoice_id: null,
    deposit_refund_status: null,
    refund_due_amount: null,
    refund_due_by: null,
    ...overrides,
  }
}

function seed(row: Record<string, unknown>, extra: Record<string, Record<string, unknown>[]> = {}) {
  state.db = createFakeSupabase({
    private_bookings: [row],
    private_booking_sms_queue: [],
    private_booking_invoices: [],
    invoices: [],
    invoice_payments: [],
    ...extra,
  })
  state.db.rpc = vi.fn(async () => ({ data: { unlinked: true, voided: true }, error: null }))
}

const stored = () => state.db.tables.private_bookings[0]

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(getPrivateBookingCancellationOutcome).mockResolvedValue({
    outcome: 'deposit_partial_refund', refund_amount: 237.5, retained_amount: 12.5, deposit_deduction: 12.5, max_retainable: 0,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cancelling a private hire with money due back', () => {
  it('records the refund owed and the date it was promised by, with the cancellation', async () => {
    seed(bookingRow())

    const result = await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(stored()).toMatchObject({
      status: 'cancelled',
      refund_due_amount: 237.5,
      refund_due_by: '2026-11-10',
      deposit_refund_status: 'refund_due',
    })
    expect(result).toMatchObject({ refundDue: { amount: 237.5, dueBy: '2026-11-10' } })
    expect(vi.mocked(sendPrivateBookingMessage).mock.calls[0][0].sms.trigger_type).toBe('booking_cancelled_partial_refund')
  })

  it('records nothing owed when no money changed hands', async () => {
    vi.mocked(getPrivateBookingCancellationOutcome).mockResolvedValue({
      outcome: 'no_money', refund_amount: 0, retained_amount: 0, deposit_deduction: 0, max_retainable: 0,
    })
    seed(bookingRow())

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(stored()).toMatchObject({ status: 'cancelled', refund_due_amount: null, deposit_refund_status: null })
  })

  it('keeps costs back from the refund, with the reason, and tells the guest what was kept', async () => {
    seed(bookingRow())

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1', {
      costsKept: { amount: 100, reason: "The DJ's deposit we can't get back" },
    })

    expect(stored()).toMatchObject({ refund_due_amount: 137.5 })
    const sent = vi.mocked(sendPrivateBookingMessage).mock.calls[0][0]
    expect(sent.sms).toMatchObject({
      trigger_type: 'booking_cancelled_retention',
      metadata: expect.objectContaining({ refund_amount: 137.5, retained_amount: 112.5, costs_kept: 100 }),
    })
    const email = sent.email!()
    expect(email.text).toContain("we've kept £112.50 to cover costs from the cancellation")
    expect(email.text).toContain("The DJ's deposit we can't get back")
  })

  it.each([
    [{ amount: 300, reason: 'Too much' }, 'cannot be more than the £237.50 refund'],
    [{ amount: 50, reason: ' ' }, 'record what the costs kept were for'],
  ])('refuses costs it cannot keep, and touches nothing', async (costsKept, message) => {
    seed(bookingRow())

    await expect(PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1', { costsKept })).rejects.toThrow(message)
    expect(stored().status).toBe('confirmed')
    expect(sendPrivateBookingMessage).not.toHaveBeenCalled()
  })
})

describe("a cancelled hire's invoices", () => {
  it('cancels an unpaid invoice with the booking', async () => {
    seed(bookingRow({ invoice_id: 'invoice-1' }), {
      invoices: [{ id: 'invoice-1', invoice_number: 'INV-001', status: 'sent', paypal_order_id: null, deleted_at: null, internal_notes: null }],
      invoice_payments: [{ id: 'p1', invoice_id: 'invoice-1', source_kind: 'booking_deposit', amount: 250 }],
    })

    const result = await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(state.db.rpc).toHaveBeenCalledWith('cancel_private_booking_invoice_atomic', {
      p_booking_id: 'booking-1', p_reason: 'The private booking was cancelled', p_actor_id: 'user-1',
    })
    expect(result.invoices).toEqual([{ invoiceId: 'invoice-1', invoiceNumber: 'INV-001', kind: 'original', result: 'voided' }])
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('leaves an invoice with money on it for a credit note, and tells a manager', async () => {
    seed(bookingRow({ invoice_id: 'invoice-1' }), {
      invoices: [{ id: 'invoice-1', invoice_number: 'INV-001', status: 'partially_paid', paypal_order_id: null, deleted_at: null, internal_notes: null }],
      invoice_payments: [{ id: 'p1', invoice_id: 'invoice-1', source_kind: 'manual', amount: 400 }],
    })

    const result = await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(state.db.rpc).not.toHaveBeenCalled()
    expect(result.invoices).toEqual([{ invoiceId: 'invoice-1', invoiceNumber: 'INV-001', kind: 'original', result: 'has_payments' }])
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(state.db, expect.objectContaining({
      kind: 'cancelled_booking_invoice_open',
      context: { 'INV-001': 'money received: issue a credit note' },
    }))
  })

  it('voids an unpaid extras invoice too', async () => {
    seed(bookingRow(), {
      private_booking_invoices: [{ booking_id: 'booking-1', invoice_id: 'invoice-2', kind: 'supplementary' }],
      invoices: [{ id: 'invoice-2', invoice_number: 'INV-002', status: 'sent', paypal_order_id: null, deleted_at: null, internal_notes: null }],
    })

    await PrivateBookingService.cancelBooking('booking-1', 'Customer asked', 'user-1')

    expect(state.db.tables.invoices[0]).toMatchObject({ status: 'void', internal_notes: expect.stringContaining('The private booking was cancelled') })
  })
})

describe('the edit form cannot cancel', () => {
  it('refuses a status change to cancelled, so every cancellation goes through the cancel dialog', async () => {
    seed(bookingRow())

    await expect(PrivateBookingService.updateBooking('booking-1', { status: 'cancelled' }, 'user-1')).rejects.toThrow(
      'Cancel a booking with Change Status on the booking page',
    )
    expect(stored().status).toBe('confirmed')
  })
})
