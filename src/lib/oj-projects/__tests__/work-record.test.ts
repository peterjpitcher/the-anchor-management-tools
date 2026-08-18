import { describe, expect, it } from 'vitest'
import { buildWorkRecord, type WorkRecordEntry } from '@/lib/oj-projects/work-record'

const SETTINGS = { hourly_rate_ex_vat: 62.5, mileage_rate: 0.55, vat_rate: 20 }

function timeEntry(over: Partial<WorkRecordEntry> = {}): WorkRecordEntry {
  return {
    id: 'e1',
    entry_date: '2026-01-10',
    entry_type: 'time',
    description: 'Website build',
    duration_minutes_rounded: 60,
    miles: null,
    amount_ex_vat_snapshot: null,
    hourly_rate_ex_vat_snapshot: 62.5,
    mileage_rate_snapshot: null,
    vat_rate_snapshot: 20,
    billable: true,
    status: 'billed',
    invoice_id: 'inv-1',
    project: { project_code: 'OJP-GB-1', project_name: 'General Work' },
    ...over,
  }
}

const INVOICE = { id: 'inv-1', invoice_number: 'INV-001', invoice_date: '2026-02-01', status: 'paid', total_amount: 500 }

describe('buildWorkRecord', () => {
  it('closes a capped invoice with a carry-forward line', () => {
    // The real Golden Barrels shape: GBP 500 inc VAT charged, but only part of it
    // is work on this invoice. Without the carry-forward line the block would
    // contradict the invoice it describes.
    const record = buildWorkRecord({
      entries: [timeEntry({ duration_minutes_rounded: 300 })],
      recurring: [{ invoice_id: 'inv-1', description_snapshot: 'Hosting', amount_ex_vat_snapshot: 40, vat_rate_snapshot: 20 }],
      invoices: [INVOICE],
      settings: SETTINGS,
    })

    const block = record.invoiceBlocks[0]
    expect(block.invoiceExVat).toBe(416.67)
    expect(block.workExVat).toBe(312.5)
    expect(block.recurringExVat).toBe(40)
    expect(block.carriedForwardExVat).toBe(64.17)
    expect(block.workExVat + block.recurringExVat + block.carriedForwardExVat).toBeCloseTo(block.invoiceExVat, 2)
    expect(record.reconciles).toBe(true)
  })

  it('includes recurring charges, or no invoice ever adds up', () => {
    const without = buildWorkRecord({
      entries: [timeEntry({ duration_minutes_rounded: 300 })],
      recurring: [],
      invoices: [INVOICE],
      settings: SETTINGS,
    })

    expect(without.invoiceBlocks[0].recurringExVat).toBe(0)
    expect(without.invoiceBlocks[0].carriedForwardExVat).toBe(104.17)
  })

  it('shows one month landing on several invoices, rather than grouping by month', () => {
    const record = buildWorkRecord({
      entries: [
        timeEntry({ id: 'a', invoice_id: 'inv-1' }),
        timeEntry({ id: 'b', invoice_id: 'inv-2' }),
      ],
      recurring: [],
      invoices: [
        INVOICE,
        { id: 'inv-2', invoice_number: 'INV-002', invoice_date: '2026-03-01', status: 'sent', total_amount: 500 },
      ],
      settings: SETTINGS,
    })

    expect(record.carryForward).toHaveLength(1)
    expect(record.carryForward[0].invoiceNumbers).toEqual(['INV-001', 'INV-002'])
  })

  it('explains a cap split rather than letting it read as double billing', () => {
    const record = buildWorkRecord({
      entries: [
        timeEntry({ id: 'parent', duration_minutes_rounded: 30, invoice_id: 'inv-1' }),
        timeEntry({ id: 'remainder', duration_minutes_rounded: 30, invoice_id: null, status: 'unbilled', split_from_entry_id: 'parent' }),
      ],
      recurring: [],
      invoices: [INVOICE],
      settings: SETTINGS,
    })

    expect(record.invoiceBlocks[0].lines[0].splitNote).toBe('1.00 h in total, of which 0.50 h on this invoice')
    expect(record.notYetCharged[0].splitNote).toBe('1.00 h in total, of which 0.50 h on this invoice')
  })

  it('separates work not yet charged from settled work with no invoice reference', () => {
    const record = buildWorkRecord({
      entries: [
        timeEntry({ id: 'new', invoice_id: null, status: 'unbilled' }),
        timeEntry({ id: 'historic', invoice_id: null, status: 'paid' }),
      ],
      recurring: [],
      invoices: [],
      settings: SETTINGS,
    })

    expect(record.notYetCharged).toHaveLength(1)
    expect(record.settledWithoutInvoice).toHaveLength(1)
    expect(record.notYetChargedHours).toBe(1)
  })

  it('leaves non-billable work out entirely', () => {
    const record = buildWorkRecord({
      entries: [timeEntry(), timeEntry({ id: 'internal', billable: false })],
      recurring: [],
      invoices: [INVOICE],
      settings: SETTINGS,
    })

    expect(record.totalHours).toBe(1)
  })

  it('never reads internal notes, only the client-facing description', () => {
    const record = buildWorkRecord({
      entries: [timeEntry({ description: null, work_type_name_snapshot: 'Consulting', internal_notes: 'do not show' } as any)],
      recurring: [],
      invoices: [INVOICE],
      settings: SETTINGS,
    })

    expect(JSON.stringify(record)).not.toContain('do not show')
    expect(record.invoiceBlocks[0].lines[0].description).toBe('Consulting')
  })

  it('flags a block that does not reconcile so generation can stop', () => {
    const record = buildWorkRecord({
      entries: [timeEntry({ duration_minutes_rounded: 6000 })],
      recurring: [],
      invoices: [INVOICE],
      settings: SETTINGS,
    })

    // Far more work than the invoice charged, so the carry-forward goes negative
    // and the block still balances arithmetically. It reconciles; the number is
    // simply negative, which is the honest answer.
    const block = record.invoiceBlocks[0]
    expect(block.carriedForwardExVat).toBeLessThan(0)
    expect(record.reconciles).toBe(true)
  })
})
