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
    // The invoice here was raised by hand, so the gap is stated as a plain
    // difference. It is not described as paying for earlier work: on INV-003VB
    // that wording claimed earlier work on the first invoice of the account.
    expect(html).toContain('Invoiced above the work logged on this invoice')
    expect(html).not.toContain('carried forward')
    expect(html).toContain('Invoice total excluding VAT')
  })

  it('explains the flat monthly amount for a capped client', () => {
    expect(html).toContain('You pay a fixed £500.00 including VAT each month')
  })

  it('shows work not yet invoiced with its value and that nothing is due for it', () => {
    expect(html).toContain('Work done, not yet invoiced')
    expect(html).toContain('2.00 hours, £125.00 excluding VAT')
    expect(html).toContain('nothing is due for it yet')
    expect(html).toContain('Value ex VAT')
  })

  it('never asks for money, so it carries no bank details', () => {
    expect(html).not.toContain('Sort Code')
    expect(html).not.toContain('How to Pay')
    expect(html).not.toMatch(/overdue/i)
  })

  it('uses the shared chrome, so it matches the invoice and statement', () => {
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Company Reg:')
    expect(html).toContain('max-width: 160px')
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
  describe('with today\'s account position', () => {
    const live = buildWorkRecord({
      entries: [
        {
          id: 'e1', entry_date: '2026-06-01', entry_type: 'time',
          description: 'Progress meeting', duration_minutes_rounded: 210,
          miles: null, amount_ex_vat_snapshot: null, hourly_rate_ex_vat_snapshot: 62.5,
          mileage_rate_snapshot: null, vat_rate_snapshot: 20, billable: true,
          status: 'billed', invoice_id: 'inv-1',
          project: { project_code: 'OJP-GB-1', project_name: 'General Work' },
        },
        {
          id: 'e2', entry_date: '2026-05-31', entry_type: 'time',
          description: 'Main launch-site build with a long description that used to squeeze the date column onto two lines',
          duration_minutes_rounded: 960,
          miles: null, amount_ex_vat_snapshot: null, hourly_rate_ex_vat_snapshot: 62.5,
          mileage_rate_snapshot: null, vat_rate_snapshot: 20, billable: true,
          status: 'unbilled', invoice_id: null,
          project: { project_code: 'OJP-GB-1', project_name: 'General Work' },
        },
        {
          id: 'e3', entry_date: '2026-01-05', entry_type: 'one_off',
          description: 'Website, stage 2 (fixed price)', duration_minutes_rounded: null,
          miles: null, amount_ex_vat_snapshot: 500, hourly_rate_ex_vat_snapshot: null,
          mileage_rate_snapshot: null, vat_rate_snapshot: 0, billable: true,
          status: 'paid', invoice_id: 'inv-0',
          project: { project_code: 'OJP-GB-2', project_name: 'Website Build' },
        },
      ],
      recurring: [{ invoice_id: 'inv-1', description_snapshot: 'Hosting', amount_ex_vat_snapshot: 40, vat_rate_snapshot: 20 }],
      invoices: [
        { id: 'inv-0', invoice_number: 'INV-000', invoice_date: '2026-01-05', status: 'paid', total_amount: 500, subtotal_amount: 500, paid_amount: 500, is_fixed_price: true, reference: 'Website, stage 2' },
        { id: 'inv-1', invoice_number: 'INV-001', invoice_date: '2026-07-01', status: 'overdue', total_amount: 500, subtotal_amount: 416.67, paid_amount: 0, reference: 'OJ Projects 2026-06' },
      ],
      settings: SETTINGS,
    })

    const html = generateWorkRecordHTML({
      ...INPUT,
      periodFrom: '2026-01-01',
      periodTo: '2026-10-09',
      record: live,
      account: {
        asAt: '2026-10-09',
        position: {
          invoicedTotal: 1000, paidTotal: 500, invoicedUnpaid: 500, unpaidInvoiceCount: 1,
          notYetInvoicedTime: 1200, notYetInvoicedMileage: 0, notYetInvoicedOneOff: 0,
          notYetInvoicedRecurring: 96, notYetInvoicedGross: 1296, invoicedOnAccount: 189.5,
          notYetInvoicedNet: 1106.5,
        },
        notYetInvoicedCharges: [
          { description: 'Seaandseeds.co.uk', period: '2026-06', exVat: 40, vatRate: 20 },
          { description: 'Seaandseeds.co.uk', period: '2026-07', exVat: 40, vatRate: 20 },
        ],
        monthlyChargesIncVat: 96,
        forecast: {
          truncated: false,
          rows: [
            { invoiceDate: '2026-11-01', amount: 500, monthlyCharges: 96, remainingAfter: 702.5 },
            { invoiceDate: '2026-12-01', amount: 500, monthlyCharges: 96, remainingAfter: 298.5 },
            { invoiceDate: '2027-01-01', amount: 394.5, monthlyCharges: 96, remainingAfter: 0 },
          ],
        },
      },
    })

    it('opens with where the account stands, so an unpaid balance cannot be missed', () => {
      expect(html).toContain('Where your account stands')
      expect(html).toContain('Invoiced and unpaid, 1 invoice')
      expect(html).toContain('Total for all work to date')
      // 500.00 unpaid plus 1,106.50 still to be invoiced.
      expect(html).toContain('£1606.50')
      expect(html).toContain('As at 09 Oct 2026, including VAT')
    })

    it('marks an unpaid invoice with what is outstanding on it', () => {
      expect(html).toContain('<span class="unpaid">unpaid, £500.00 outstanding</span>')
      expect(html).not.toContain(', outstanding</span>')
    })

    it('says a flat monthly invoice took the difference on account', () => {
      expect(html).toContain('Invoiced on account, set against work still to be invoiced')
      expect(html).not.toContain('carried forward')
    })

    it('lists regular charges not yet invoiced, which used to be invisible', () => {
      expect(html).toContain('Regular charges listed above')
      expect(html).toContain('Seaandseeds.co.uk')
    })

    it('adds the not-yet-invoiced section up to the penny', () => {
      // 1,000.00 work + 80.00 charges + 216.00 VAT - 189.50 on account.
      expect(html).toContain('Work listed above, 16.00 hours')
      expect(html).toMatch(/<td>VAT<\/td>\s*<td class="num">£216\.00<\/td>/)
      expect(html).toContain('Less already invoiced on account')
      expect(html).toContain('-£189.50')
      expect(html).toMatch(/Still to be invoiced, including VAT<\/td>\s*<td class="num">£1106\.50<\/td>/)
      expect(html).not.toContain('outside the dates of this record')
    })

    it('forecasts the invoices to come and says what it assumes', () => {
      expect(html).toContain('Invoices to come')
      expect(html).toContain('November 2026')
      expect(html).toContain('January 2027')
      expect(html).toContain('assuming no new work is added')
      expect(html).toContain('regular charges of £96.00 a month')
      expect(html).toContain('in addition to the invoices already unpaid')
    })

    it('says nothing about hours on a fixed-price stage with none logged', () => {
      expect(html).toContain('Agreed fixed price for this stage')
      expect(html).not.toContain('0.00 hours')
    })

    it('fixes the line table columns so a long description cannot squeeze the date', () => {
      expect(html).toContain('table-layout: fixed')
      expect(html).toContain('<col class="c-date">')
      expect(html).toContain('<td class="nowrap">31 May 2026</td>')
    })

    it('renders no broken values', () => {
      expect(html).not.toMatch(/undefined|NaN|Invalid Date/)
    })
  })
})
