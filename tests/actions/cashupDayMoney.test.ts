import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-119 (owner decision D33): the cash-up shows what was paid for the day outside the till, so a
 * gap between till sales and takings can be explained: deposits, tickets, private-hire money paid
 * online or by bank, and vouchers.
 */

const state = vi.hoisted(() => ({ db: null as unknown, canView: true }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.canView) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { getCashupDayMoneyAction } from '@/app/actions/cashup-day-money'

beforeEach(() => {
  state.canView = true
  state.db = createFakeSupabase({
    online_income_movements: [
      { source: 'table_deposit', source_id: 'tb-1', visit_date: '2026-10-10', net: 160, status: 'applied' },
      { source: 'table_deposit', source_id: 'tb-2', visit_date: '2026-10-10', net: 40, status: 'kept' },
      { source: 'table_deposit', source_id: 'tb-3', visit_date: '2026-10-11', net: 80, status: 'held' },
      { source: 'event_ticket', source_id: 'b-1', visit_date: '2026-10-10', net: 45, status: 'earned' },
      { source: 'private_hire_deposit', source_id: 'pb-1', visit_date: '2026-10-10', net: 250, status: 'applied' },
    ],
    private_bookings: [
      { id: 'pb-1', event_date: '2026-10-10', status: 'confirmed', event_type: 'Christening', invoice_id: 'inv-1', date_tbd: false },
      { id: 'pb-2', event_date: '2026-10-10', status: 'confirmed', event_type: 'Placeholder', invoice_id: null, date_tbd: true },
      { id: 'pb-3', event_date: '2026-10-10', status: 'cancelled', event_type: 'Birthday', invoice_id: null, date_tbd: false },
    ],
    private_booking_invoices: [{ booking_id: 'pb-1', invoice_id: 'inv-2' }],
    private_booking_payments: [
      { booking_id: 'pb-1', amount: 100, method: 'cash' },
      { booking_id: 'pb-1', amount: 200, method: 'invoice' },
    ],
    invoice_payments: [
      { invoice_id: 'inv-1', amount: 300, payment_method: 'bank_transfer', source_kind: null },
      { invoice_id: 'inv-1', amount: 250, payment_method: 'other', source_kind: 'booking_deposit' },
      { invoice_id: 'inv-1', amount: 20, payment_method: 'card', source_kind: null },
      { invoice_id: 'inv-2', amount: 50, payment_method: 'paypal', source_kind: 'paypal' },
    ],
    vouchers: [
      { value_pence: 2500, status: 'redeemed', redeemed_at: '2026-10-10T12:00:00.000Z' },
      // 00:30 on 10 October in London (BST).
      { value_pence: 1000, status: 'redeemed', redeemed_at: '2026-10-09T23:30:00.000Z' },
      // 00:30 on 11 October in London: the next day.
      { value_pence: 500, status: 'redeemed', redeemed_at: '2026-10-10T23:30:00.000Z' },
      { value_pence: 900, status: 'cancelled', redeemed_at: '2026-10-10T12:00:00.000Z' },
    ],
  })
})

describe('money paid outside the till for a cash-up day', () => {
  it('adds up deposits, tickets, private-hire money and vouchers for the London day', async () => {
    const result = await getCashupDayMoneyAction('2026-10-10')

    expect(result).toEqual({
      success: true,
      data: {
        tableDeposits: { count: 1, amount: 160 },
        eventTickets: { count: 1, amount: 45 },
        // Deposit 250 by PayPal, 200 recorded as paid by invoice, 300 by bank and 50 by PayPal
        // invoice. Cash, card and the invoice copy of the deposit are left out.
        privateHires: [{ id: 'pb-1', label: 'Christening', paidOutsideTill: 800 }],
        vouchersRedeemed: { count: 2, amount: 35 },
        total: 1040,
      },
    })
  })

  it('needs the cash-up permission', async () => {
    state.canView = false
    expect(await getCashupDayMoneyAction('2026-10-10')).toEqual({ success: false, error: 'Forbidden' })
  })

  it('says so when it cannot be read, rather than showing nothing', async () => {
    ;(state.db as { failures: unknown[] }).failures.push({ table: 'vouchers', op: 'select', error: { message: 'boom' } })
    expect(await getCashupDayMoneyAction('2026-10-10')).toEqual({ success: false, error: 'Money paid outside the till could not be loaded.' })
  })
})
