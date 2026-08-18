import { describe, expect, it } from 'vitest'
import { generateWorkRecordHTML, generateWorkRecordPDF } from '@/lib/oj-work-record'
import { buildWorkRecord } from '@/lib/oj-projects/work-record'

const SETTINGS = { hourly_rate_ex_vat: 62.5, vat_rate: 20, mileage_rate: 0.55 }

const record = buildWorkRecord({
  entries: [
    {
      id: 'e1', entry_date: '2026-01-10', entry_type: 'time',
      description: 'Sea & Seeds <build> call', duration_minutes_rounded: 300,
      miles: null, amount_ex_vat_snapshot: null, hourly_rate_ex_vat_snapshot: 62.5,
      mileage_rate_snapshot: null, vat_rate_snapshot: 20, billable: true,
      status: 'billed', invoice_id: 'inv-1',
      project: { project_code: 'OJP-GB-1', project_name: 'General & Co' },
    },
    {
      id: 'e2', entry_date: '2026-02-10', entry_type: 'time',
      description: 'Later work', duration_minutes_rounded: 120,
      miles: null, amount_ex_vat_snapshot: null, hourly_rate_ex_vat_snapshot: 62.5,
      mileage_rate_snapshot: null, vat_rate_snapshot: 20, billable: true,
      status: 'unbilled', invoice_id: null,
      project: { project_code: 'OJP-GB-1', project_name: 'General & Co' },
    },
  ],
  recurring: [{ invoice_id: 'inv-1', description_snapshot: 'Hosting', amount_ex_vat_snapshot: 40, vat_rate_snapshot: 20 }],
  invoices: [{ id: 'inv-1', invoice_number: 'INV-001', invoice_date: '2026-02-01', status: 'paid', total_amount: 500 }],
  settings: SETTINGS,
})

const INPUT = {
  vendorName: 'Golden Barrels <Ltd>',
  periodFrom: '2026-01-01',
  periodTo: '2026-02-28',
  record,
  monthlyCapIncVat: 500,
}

describe('work record template', () => {
  const html = generateWorkRecordHTML(INPUT)

  it('escapes client-supplied text rather than emitting raw markup', () => {
    expect(html).toContain('&lt;Ltd&gt;')
    expect(html).not.toContain('<Ltd>')
    expect(html).toContain('&lt;build&gt;')
  })

  it('states the invoice each piece of work was charged on', () => {
    expect(html).toContain('How it was invoiced')
    expect(html).toContain('INV-001')
  })

  it('closes each invoice block so it agrees with the invoice', () => {
    expect(html).toContain('Payment towards earlier work carried forward')
    expect(html).toContain('Invoice total excluding VAT')
  })

  it('explains the flat monthly amount for a capped client', () => {
    expect(html).toContain('You pay a fixed £500.00 including VAT each month')
  })

  it('shows work not yet charged with nothing to pay', () => {
    expect(html).toContain('Work done, not yet charged')
    expect(html).toContain('There is nothing to pay for this yet')
  })

  it('never asks for money, so it carries no bank details', () => {
    expect(html).not.toContain('Sort Code')
    expect(html).not.toContain('How to Pay')
    expect(html).not.toMatch(/overdue/i)
  })

  it('uses the shared chrome, so it matches the invoice and statement', () => {
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Company Reg:')
    expect(html).toContain('max-width: 90px')
  })

  it('keeps page one as a self-contained answer', () => {
    expect(html).toContain('page-break-before: always')
  })

  it('refuses to produce a PDF that does not agree with its invoices', async () => {
    await expect(
      generateWorkRecordPDF({ ...INPUT, record: { ...record, reconciles: false } })
    ).rejects.toThrow(/did not reconcile/)
  })

  it('describes a fixed-price stage as an agreed price, not a carry-forward', () => {
    const fixed = buildWorkRecord({
      entries: [
        {
          id: 'e1', entry_date: '2026-01-13', entry_type: 'time',
          description: 'Front-end architecture', duration_minutes_rounded: 300,
          miles: null, amount_ex_vat_snapshot: null, hourly_rate_ex_vat_snapshot: 75,
          mileage_rate_snapshot: null, vat_rate_snapshot: 20, billable: true,
          status: 'paid', invoice_id: 'inv-1',
          project: { project_code: 'OJP-GB-1', project_name: 'Dukes Head website' },
        },
      ],
      recurring: [],
      invoices: [{ id: 'inv-1', invoice_number: 'INV-003VI', invoice_date: '2026-01-02', status: 'paid', total_amount: 500, is_fixed_price: true }],
      settings: SETTINGS,
    })

    const html = generateWorkRecordHTML({ ...INPUT, record: fixed, monthlyCapIncVat: null })

    expect(html).toContain('Agreed fixed price for this stage')
    expect(html).toContain('Time spent on this stage')
    expect(html).not.toContain('carried forward to a later invoice')
  })
})
