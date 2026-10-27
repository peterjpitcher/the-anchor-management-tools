import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../../../tests/helpers/fakeSupabase'

/**
 * BK-117 (owner decision D33): money taken online, summed by kind and status, the P&L's own line
 * (booking money only) and the accountant's CSV.
 */

const state = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))

import {
  buildOnlineIncomeCsv,
  loadOnlineIncome,
  sumOnlineBookingIncomeSince,
  summariseOnlineIncome,
  type OnlineIncomeRow,
} from './online-income'

function row(overrides: Partial<OnlineIncomeRow>): OnlineIncomeRow {
  return {
    source: 'table_deposit',
    sourceId: 'id-1',
    moneyDate: '2026-10-05',
    reference: 'TB-1',
    visitDate: '2026-10-10',
    gross: 160,
    refunded: 0,
    net: 160,
    method: 'paypal',
    captureId: 'CAP-1',
    paypalFee: null,
    status: 'held',
    isBookingMoney: true,
    ...overrides,
  }
}

function viewRow(overrides: Record<string, unknown>) {
  return {
    source: 'event_ticket', source_id: 'b1', money_date: '2026-10-01', booking_reference: 'Quiz night',
    visit_date: '2026-10-07', gross: '40.00', refunded: '0.00', net: '40.00', method: 'paypal',
    capture_id: 'CAP-T', paypal_fee: null, status: 'earned', is_booking_money: true,
    ...overrides,
  }
}

describe('online income (BK-117)', () => {
  it('sums by kind and status, and counts only booking money in the P&L line', () => {
    const summary = summariseOnlineIncome([
      row({ sourceId: 'a', gross: 160, net: 160, paypalFee: 5.42 }),
      row({ sourceId: 'b', gross: 80, refunded: 50.25, net: 29.75, status: 'part_refunded' }),
      row({ sourceId: 'c', source: 'invoice', gross: 420, net: 420, status: 'paid', isBookingMoney: false }),
      row({ sourceId: 'd', source: 'table_deposit', method: 'stripe', gross: 40, net: 40, status: 'kept', captureId: 'pi_1' }),
    ])

    expect(summary.total).toEqual({ count: 4, gross: 700, refunded: 50.25, net: 649.75, paypalFees: 5.42, feesUnknown: 2 })
    expect(summary.bookingMoneyNet).toBe(229.75)
    expect(summary.bySource.map((line) => [line.source, line.totals.net])).toEqual([
      ['table_deposit', 229.75],
      ['invoice', 420],
    ])
    expect(summary.byStatus.find((line) => line.status === 'kept')).toEqual({ status: 'kept', label: 'Kept (cancelled or no-show)', net: 40, count: 1 })
  })

  it('writes a CSV the accountant can open: UK dates, pence, no formulas', () => {
    const csv = buildOnlineIncomeCsv([
      row({ reference: '=HYPERLINK("x")', paypalFee: 1.5, refunded: 10, net: 150 }),
    ]).toString('utf-8')
    const lines = csv.replace(/^﻿/, '').split('\n')

    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[0]).toBe('Date taken,Kind,Reference,Visit date,Gross,Refunded,Net,PayPal fee,Method,Status,Booking money,PayPal capture id')
    expect(lines[1]).toBe('05/10/2026,Table deposit,"\t=HYPERLINK(""x"")",10/10/2026,160.00,10.00,150.00,1.50,PayPal,Held (visit to come),Yes,CAP-1')
  })

  it('loads the payments taken between two London dates from the view', async () => {
    state.db = createFakeSupabase({
      online_income_movements: [
        viewRow({ source_id: 'early', money_date: '2026-09-30' }),
        viewRow({ source_id: 'in', money_date: '2026-10-01', paypal_fee: '1.10' }),
        viewRow({ source_id: 'late', money_date: '2026-11-01' }),
      ],
    })

    const rows = await loadOnlineIncome({ from: '2026-10-01', to: '2026-10-31' })

    expect(rows).toEqual([
      expect.objectContaining({ sourceId: 'in', moneyDate: '2026-10-01', gross: 40, net: 40, paypalFee: 1.1, isBookingMoney: true }),
    ])
  })

  it('fails loudly when the view cannot be read', async () => {
    const db = createFakeSupabase({ online_income_movements: [] })
    db.failures.push({ table: 'online_income_movements', op: 'select', error: { message: 'permission denied' } })
    state.db = db

    await expect(loadOnlineIncome({ from: '2026-10-01', to: '2026-10-31' })).rejects.toThrow('Failed to load online income: permission denied')
  })

  it('sums booking money from each start date for the P&L line, leaving out invoices for no booking', async () => {
    const db = createFakeSupabase({
      online_income_movements: [
        viewRow({ source_id: 'a', money_date: '2026-07-01', net: '100.00' }),
        viewRow({ source_id: 'b', money_date: '2026-10-01', net: '40.00' }),
        viewRow({ source_id: 'c', money_date: '2026-10-20', net: '29.75' }),
        viewRow({ source_id: 'd', money_date: '2026-10-21', net: '420.00', source: 'invoice', is_booking_money: false }),
      ],
    })

    const totals = await sumOnlineBookingIncomeSince(db as never, { '1m': '2026-09-27', '3m': '2026-07-29', '12m': '2025-10-27' })

    expect(totals).toEqual({ '1m': 69.75, '3m': 69.75, '12m': 169.75 })
  })
})
