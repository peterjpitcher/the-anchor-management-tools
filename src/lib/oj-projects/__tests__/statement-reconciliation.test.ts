import { describe, expect, it } from 'vitest'
import { generateStatementHTML } from '@/lib/oj-statement'
import { buildStatementAgeing } from '@/lib/oj-projects/statement-ageing'

/**
 * The reconciliation sentence is the only line on the statement that asserts
 * lateness, so it has to be right. It previously summed every bucket, including
 * "Not yet due", and called the total "Amounts overdue".
 */

const BASE: any = {
  vendorName: 'Acme Ltd',
  periodFrom: '2026-08-01',
  periodTo: '2026-08-31',
  openingBalance: 0,
  transactions: [],
}

describe('statement reconciliation wording', () => {
  it('does not call money that is not yet due overdue', () => {
    const ageing = buildStatementAgeing([{ dueDate: '2026-09-10', remaining: 500 }], '2026-08-31')
    const html = generateStatementHTML({ ...BASE, ageing, closingBalance: ageing.netTotal })

    expect(html).toContain('Not yet due £500.00')
    expect(html).toContain('overdue £0.00')
    expect(html).not.toContain('Overdue £500.00')
  })

  it('separates the two when a client has both', () => {
    const ageing = buildStatementAgeing(
      [
        { dueDate: '2026-09-10', remaining: 200 },
        { dueDate: '2026-07-01', remaining: 300 },
      ],
      '2026-08-31'
    )
    const html = generateStatementHTML({ ...BASE, ageing, closingBalance: ageing.netTotal })

    expect(html).toContain('Not yet due £200.00')
    expect(html).toContain('overdue £300.00')
    expect(html).toContain('equals the closing balance of £500.00')
  })

  it('reads plainly when everything is overdue', () => {
    const ageing = buildStatementAgeing([{ dueDate: '2026-07-01', remaining: 300 }], '2026-08-31')
    const html = generateStatementHTML({ ...BASE, ageing, closingBalance: ageing.netTotal })

    expect(html).toContain('Overdue £300.00')
    expect(html).not.toContain('Not yet due £')
  })

  it('still warns when the figures do not agree', () => {
    const ageing = buildStatementAgeing([{ dueDate: '2026-07-01', remaining: 300 }], '2026-08-31')
    const html = generateStatementHTML({ ...BASE, ageing, closingBalance: 999 })

    expect(html).toContain('do not agree, so please contact us before paying')
  })
})
