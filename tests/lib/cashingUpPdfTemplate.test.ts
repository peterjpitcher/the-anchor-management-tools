import { describe, expect, it } from 'vitest'
import { generateWeeklyCashupHTML, type WeeklyReportRow } from '@/lib/cashing-up-pdf-template'

describe('generateWeeklyCashupHTML', () => {
  it('renders weekly totals for accounting and target delivery columns', () => {
    const weekData: WeeklyReportRow[] = [
      {
        date: '2026-05-23',
        status: 'submitted',
        notes: null,
        cash_expected: 168.1,
        cash_actual: 154.2,
        card_expected: 1674.23,
        card_actual: 1674.23,
        stripe_actual: 0,
        total_expected: 1842.33,
        total_actual: 1828.43,
        total_variance: -13.9,
        daily_target: 1400,
        accumulated_target: 1400,
        accumulated_revenue: 1828.43,
        cash_counts: [],
      },
      {
        date: '2026-05-24',
        status: 'submitted',
        notes: null,
        cash_expected: 110,
        cash_actual: 100,
        card_expected: 0,
        card_actual: 0,
        stripe_actual: 0,
        total_expected: 110,
        total_actual: 100,
        total_variance: -10,
        daily_target: 800,
        accumulated_target: 2200,
        accumulated_revenue: 1928.43,
        cash_counts: [],
      },
    ]

    const html = generateWeeklyCashupHTML({
      weekData,
      siteName: 'The Anchor',
      weekStartDate: '2026-05-18',
    })

    expect(html).toContain('WEEKLY TOTALS')
    expect(html).toContain('£278.10')
    expect(html).toContain('£254.20')
    expect(html).toContain('£1,952.33')
    expect(html).toContain('£1,928.43')
    expect(html).toContain('£-23.90')
    expect(html).toContain('£2,200.00')
    expect(html).toContain('88%')
  })
})
