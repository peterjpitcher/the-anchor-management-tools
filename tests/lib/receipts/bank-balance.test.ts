import { describe, expect, it } from 'vitest'
import {
  buildDailyBankBalanceSeries,
  filterBankBalancePoints,
  type BankBalanceRow,
} from '@/lib/receipts/bank-balance'

function row(
  id: string,
  date: string,
  balance: number | null,
  amountIn: number | null,
  amountOut: number | null,
): BankBalanceRow {
  return {
    id,
    transaction_date: date,
    balance,
    amount_in: amountIn,
    amount_out: amountOut,
  }
}

describe('bank balance history', () => {
  it('reconstructs the daily closing balance when same-day rows arrive out of order', () => {
    const points = buildDailyBankBalanceSeries([
      row('c', '2026-08-02', 160, 0, 20),
      row('a', '2026-08-01', 100, 100, 0),
      row('b', '2026-08-02', 180, 80, 0),
      row('d', '2026-08-02', 150, 0, 10),
    ])

    expect(points).toEqual([
      { date: '2026-08-01', balance: 100 },
      { date: '2026-08-02', balance: 150 },
    ])
  })

  it('ignores unusable rows and sorts days oldest to newest', () => {
    const points = buildDailyBankBalanceSeries([
      row('b', '2026-08-03', 90, 0, 10),
      row('missing', '2026-08-02', null, 10, 0),
      { ...row('invalid', '2026-08-01', 50, 50, 0), transaction_date: null },
      row('a', '2026-08-02', 100, 100, 0),
    ])

    expect(points).toEqual([
      { date: '2026-08-02', balance: 100 },
      { date: '2026-08-03', balance: 90 },
    ])
  })

  it('anchors fixed ranges to the latest bank entry and supports all time', () => {
    const points = [
      { date: '2026-06-01', balance: 80 },
      { date: '2026-07-02', balance: 100 },
      { date: '2026-07-31', balance: 120 },
    ]

    expect(filterBankBalancePoints(points, '30d')).toEqual(points.slice(1))
    expect(filterBankBalancePoints(points, 'all')).toBe(points)
  })
})
