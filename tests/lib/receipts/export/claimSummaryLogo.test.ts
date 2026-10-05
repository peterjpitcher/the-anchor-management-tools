import { PassThrough } from 'node:stream'
import type { Archiver } from 'archiver'
import { describe, expect, it } from 'vitest'
import { appendClaimSummaryPdf } from '@/lib/receipts/export/claim-summary-pdf'

/** Runs the real pdfkit render and returns the PDF it appends to the accountant ZIP. */
async function renderClaimSummary(): Promise<Buffer> {
  const chunks: Buffer[] = []
  const finished = new Promise<void>((resolve) => {
    const archive = {
      append(stream: PassThrough) {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => resolve())
        return archive
      },
    }
    void appendClaimSummaryPdf(archive as unknown as Archiver, {
      year: 2026,
      quarter: 2,
      mileage: null,
      expenses: { totalEntries: 0, grossTotal: 0, vatTotal: 0, expenseIds: [] },
      mgd: {
        periodStart: '2026-04-01',
        periodEnd: '2026-06-30',
        periodLabel: 'Apr to Jun 2026',
        totalCollections: 0,
        totalNetTake: 0,
        totalMgd: 0,
        totalVatOnSupplier: 0,
      },
      mgdFileName: 'MGD_AprJun_2026.csv',
      hasExpenseImages: false,
      expenseRows: [],
      mgdRows: [],
    })
  })
  await finished
  return Buffer.concat(chunks)
}

describe('appendClaimSummaryPdf', () => {
  it('embeds the Orange Jelly wordmark with its transparency', async () => {
    const pdf = (await renderClaimSummary()).toString('latin1')

    expect(pdf.startsWith('%PDF')).toBe(true)
    expect(pdf).toContain('/Subtype /Image')
    // The wordmark is 1200 by 260. A palette copy once drew doubled; see documentLogo.test.ts.
    expect(pdf).toContain('/Width 1200')
    expect(pdf).toContain('/Height 260')
    expect(pdf).toContain('/SMask')
  })
})
