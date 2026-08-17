import { describe, expect, it } from 'vitest'
import {
  bucketForDaysOverdue,
  buildStatementAgeing,
  daysOverdue,
} from '@/lib/oj-projects/statement-ageing'

/**
 * The decision these lock in: ageing is measured by days OVERDUE, not days since
 * the invoice date. Every client is on 7-day terms, so invoice-date ageing would
 * have reported a nine-day-late invoice as current. See the module comment.
 */

const asAt = '2026-08-17'

describe('daysOverdue', () => {
  it('counts whole calendar days past the due date', () => {
    expect(daysOverdue('2026-08-08', asAt)).toBe(9)
    expect(daysOverdue('2026-07-08', asAt)).toBe(40)
  })

  it('returns zero on the due date itself, so a bill due today is not yet late', () => {
    expect(daysOverdue(asAt, asAt)).toBe(0)
  })

  it('goes negative for an invoice not yet due', () => {
    expect(daysOverdue('2026-08-31', asAt)).toBe(-14)
  })

  it('treats an unreadable due date as not yet due rather than dropping it', () => {
    // Dropping the invoice would remove money from a total that has to reconcile.
    expect(daysOverdue('not-a-date', asAt)).toBe(0)
  })
})

describe('bucketForDaysOverdue', () => {
  it('places each boundary in the bucket the labels promise', () => {
    expect(bucketForDaysOverdue(0)).toBe('not_yet_due')
    expect(bucketForDaysOverdue(1)).toBe('overdue_1_30')
    expect(bucketForDaysOverdue(30)).toBe('overdue_1_30')
    expect(bucketForDaysOverdue(31)).toBe('overdue_31_60')
    expect(bucketForDaysOverdue(60)).toBe('overdue_31_60')
    expect(bucketForDaysOverdue(61)).toBe('overdue_61_90')
    expect(bucketForDaysOverdue(90)).toBe('overdue_61_90')
    expect(bucketForDaysOverdue(91)).toBe('overdue_90_plus')
  })
})

describe('buildStatementAgeing', () => {
  it('ages the real Golden Barrels position by how late each invoice is', () => {
    // Both invoices as they stood on 2026-08-17. Aged from the invoice date,
    // INV-003W9 at 16 days old would have shown as current despite being late.
    const ageing = buildStatementAgeing(
      [
        { dueDate: '2026-08-08', remaining: 500 },
        { dueDate: '2026-07-08', remaining: 500 },
      ],
      asAt
    )

    const amount = (key: string) => ageing.buckets.find((b) => b.key === key)?.amount

    expect(amount('not_yet_due')).toBe(0)
    expect(amount('overdue_1_30')).toBe(500)
    expect(amount('overdue_31_60')).toBe(500)
    expect(ageing.receivablesTotal).toBe(1000)
  })

  it('reconciles: buckets less credit equals the net position', () => {
    const ageing = buildStatementAgeing(
      [
        { dueDate: '2026-08-08', remaining: 500 },
        { dueDate: '2026-06-08', remaining: 120.5 },
      ],
      asAt
    )

    expect(ageing.netTotal).toBe(ageing.receivablesTotal - ageing.creditTotal)
    expect(ageing.netTotal).toBe(620.5)
  })

  it('keeps an overpaid invoice out of the buckets and reports it as credit', () => {
    const ageing = buildStatementAgeing(
      [
        { dueDate: '2026-07-08', remaining: 500 },
        { dueDate: '2026-06-08', remaining: -75.25 },
      ],
      asAt
    )

    // Buckets read purely as debt; the credit is stated separately so the
    // columns cannot quietly net off against real arrears.
    expect(ageing.receivablesTotal).toBe(500)
    expect(ageing.creditTotal).toBe(75.25)
    expect(ageing.netTotal).toBe(424.75)
  })

  it('reports a net credit when the client is in credit overall', () => {
    const ageing = buildStatementAgeing([{ dueDate: '2026-06-08', remaining: -200 }], asAt)

    expect(ageing.receivablesTotal).toBe(0)
    expect(ageing.creditTotal).toBe(200)
    expect(ageing.netTotal).toBe(-200)
  })

  it('ignores settled invoices', () => {
    const ageing = buildStatementAgeing(
      [
        { dueDate: '2026-07-08', remaining: 0 },
        { dueDate: '2026-08-08', remaining: 250 },
      ],
      asAt
    )

    expect(ageing.receivablesTotal).toBe(250)
  })

  it('rounds each balance before summing, so the columns add up exactly', () => {
    const ageing = buildStatementAgeing(
      [
        { dueDate: '2026-08-08', remaining: 0.005 },
        { dueDate: '2026-08-08', remaining: 0.005 },
        { dueDate: '2026-08-08', remaining: 10.014 },
      ],
      asAt
    )

    const bucketSum = ageing.buckets.reduce((acc, b) => acc + b.amount, 0)
    expect(ageing.receivablesTotal).toBe(Number(bucketSum.toFixed(2)))
  })

  it('returns every bucket even when empty, so the strip keeps its shape', () => {
    const ageing = buildStatementAgeing([], asAt)

    expect(ageing.buckets.map((b) => b.key)).toEqual([
      'not_yet_due',
      'overdue_1_30',
      'overdue_31_60',
      'overdue_61_90',
      'overdue_90_plus',
    ])
    expect(ageing.receivablesTotal).toBe(0)
    expect(ageing.netTotal).toBe(0)
  })

  it('measures as at the date given, not today', () => {
    const earlier = buildStatementAgeing([{ dueDate: '2026-07-08', remaining: 500 }], '2026-07-20')
    const later = buildStatementAgeing([{ dueDate: '2026-07-08', remaining: 500 }], asAt)

    expect(earlier.buckets.find((b) => b.key === 'overdue_1_30')?.amount).toBe(500)
    expect(later.buckets.find((b) => b.key === 'overdue_31_60')?.amount).toBe(500)
    expect(earlier.asAt).toBe('2026-07-20')
  })
})
