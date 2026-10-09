import { describe, expect, it } from 'vitest'
import {
  buildAccountPosition,
  buildInvoiceForecast,
  isEngineInvoice,
  nextInvoiceDate,
  toStatementPosition,
  type PositionEntry,
  type PositionInvoice,
  type PositionRecurring,
} from '@/lib/oj-projects/account-position'

const SETTINGS = { hourly_rate_ex_vat: 62.5, vat_rate: 20, mileage_rate: 0.55 }

function time(minutes: number, over: Partial<PositionEntry> = {}): PositionEntry {
  return {
    entry_type: 'time',
    duration_minutes_rounded: minutes,
    miles: null,
    amount_ex_vat_snapshot: null,
    hourly_rate_ex_vat_snapshot: 62.5,
    mileage_rate_snapshot: null,
    vat_rate_snapshot: 20,
    billable: true,
    status: 'unbilled',
    invoice_id: null,
    ...over,
  }
}

function charge(over: Partial<PositionRecurring> = {}): PositionRecurring {
  return { status: 'unbilled', invoice_id: null, amount_ex_vat_snapshot: 40, vat_rate_snapshot: 20, ...over }
}

function invoice(over: Partial<PositionInvoice> = {}): PositionInvoice {
  return {
    id: 'inv-1',
    status: 'paid',
    total_amount: 500,
    paid_amount: 500,
    reference: 'OJ Projects 2026-06',
    is_fixed_price: false,
    ...over,
  }
}

describe('buildAccountPosition', () => {
  it('values work not yet invoiced including VAT, by kind', () => {
    const position = buildAccountPosition({
      entries: [
        time(960),
        { ...time(0), entry_type: 'mileage', duration_minutes_rounded: null, miles: 40 },
        { ...time(0), entry_type: 'one_off', duration_minutes_rounded: null, amount_ex_vat_snapshot: 90 },
      ],
      recurring: [charge(), charge()],
      invoices: [],
      settings: SETTINGS,
    })

    expect(position.notYetInvoicedTime).toBe(1200)
    // Mileage is a disbursement and carries no VAT.
    expect(position.notYetInvoicedMileage).toBe(22)
    expect(position.notYetInvoicedOneOff).toBe(108)
    expect(position.notYetInvoicedRecurring).toBe(96)
    expect(position.notYetInvoicedGross).toBe(1426)
    expect(position.notYetInvoicedNet).toBe(1426)
  })

  it('takes money invoiced with no work behind it off what is still to be invoiced', () => {
    // INV-003WC: GBP 500 invoiced, GBP 310.50 of work and hosting attached. The
    // other GBP 189.50 was invoiced on account while a 16 hour entry stayed
    // wholly unbilled, so without this it is asked for twice.
    const position = buildAccountPosition({
      entries: [time(210, { status: 'billed', invoice_id: 'inv-1' }), time(960)],
      recurring: [charge({ status: 'billed', invoice_id: 'inv-1' })],
      invoices: [invoice({ status: 'overdue', paid_amount: 0 })],
      settings: SETTINGS,
    })

    expect(position.invoicedOnAccount).toBe(189.5)
    expect(position.notYetInvoicedGross).toBe(1200)
    expect(position.notYetInvoicedNet).toBe(1010.5)
    expect(position.invoicedUnpaid).toBe(500)
  })

  it('lets an invoice that carries more work than it charged use the balance up', () => {
    const position = buildAccountPosition({
      entries: [
        time(240, { status: 'paid', invoice_id: 'inv-1' }), // 300.00 on a 500.00 invoice
        time(480, { status: 'billed', invoice_id: 'inv-2' }), // 600.00 on a 500.00 invoice
        time(60),
      ],
      recurring: [],
      invoices: [invoice(), invoice({ id: 'inv-2', reference: 'OJ Projects 2026-07' })],
      settings: SETTINGS,
    })

    // 200 over on the first, 100 under on the second leaves 100 on account,
    // which is more than the 75 of work waiting, so it is capped there.
    expect(position.invoicedOnAccount).toBe(75)
    expect(position.notYetInvoicedNet).toBe(0)
  })

  it('never reports more on account than there is work to set it against', () => {
    const position = buildAccountPosition({
      entries: [time(60)],
      recurring: [],
      invoices: [invoice()],
      settings: SETTINGS,
    })

    expect(position.notYetInvoicedGross).toBe(75)
    expect(position.invoicedOnAccount).toBe(75)
    expect(position.notYetInvoicedNet).toBe(0)
  })

  it('ignores invoices the billing run did not size', () => {
    // A fixed-price stage and a hand-raised invoice are not worth the hours on
    // them, so the gap is not a balance on account.
    const position = buildAccountPosition({
      entries: [time(60)],
      recurring: [],
      invoices: [
        invoice({ reference: 'OJ Projects 2026-01', is_fixed_price: true }),
        invoice({ id: 'inv-2', reference: 'Vision Workshop' }),
        invoice({ id: 'inv-3', reference: null }),
      ],
      settings: SETTINGS,
    })

    expect(position.invoicedOnAccount).toBe(0)
    expect(isEngineInvoice({ reference: '  oj projects 2026-09', is_fixed_price: false })).toBe(true)
  })

  it('leaves out charges that have been switched off and work that is not billable', () => {
    const position = buildAccountPosition({
      entries: [time(60, { billable: false })],
      recurring: [charge({ charge_active: false })],
      invoices: [],
      settings: SETTINGS,
    })

    expect(position.notYetInvoicedGross).toBe(0)
  })

  it('counts what has been invoiced, paid and left unpaid', () => {
    const position = buildAccountPosition({
      entries: [],
      recurring: [],
      invoices: [
        invoice(),
        invoice({ id: 'inv-2', status: 'overdue', paid_amount: 0 }),
        invoice({ id: 'inv-3', status: 'partially_paid', paid_amount: 200 }),
      ],
      settings: SETTINGS,
    })

    expect(position.invoicedTotal).toBe(1500)
    expect(position.paidTotal).toBe(700)
    expect(position.invoicedUnpaid).toBe(800)
    expect(position.unpaidInvoiceCount).toBe(2)
  })

  it('hands the statement the same figures', () => {
    const position = buildAccountPosition({
      entries: [time(960), { ...time(0), entry_type: 'mileage', duration_minutes_rounded: null, miles: 40 }],
      recurring: [charge()],
      invoices: [],
      settings: SETTINGS,
    })

    expect(toStatementPosition(position, '2026-10-09', 500)).toEqual({
      asAt: '2026-10-09',
      notYetInvoicedWork: 1222,
      notYetInvoicedCharges: 48,
      invoicedOnAccount: 0,
      notYetInvoicedNet: 1270,
      monthlyCapIncVat: 500,
    })
  })
})

describe('buildInvoiceForecast', () => {
  it('starts on the first of next month, whatever today is', () => {
    expect(nextInvoiceDate('2026-10-09')).toBe('2026-11-01')
    expect(nextInvoiceDate('2026-12-31')).toBe('2027-01-01')
  })

  it('counts the regular charges every month until the balance clears', () => {
    const forecast = buildInvoiceForecast({
      startingBalance: 1000,
      monthlyCapIncVat: 500,
      monthlyChargesIncVat: 96,
      firstInvoiceDate: '2026-11-01',
    })

    expect(forecast.truncated).toBe(false)
    expect(forecast.rows).toEqual([
      { invoiceDate: '2026-11-01', amount: 500, monthlyCharges: 96, remainingAfter: 596 },
      { invoiceDate: '2026-12-01', amount: 500, monthlyCharges: 96, remainingAfter: 192 },
      { invoiceDate: '2027-01-01', amount: 288, monthlyCharges: 96, remainingAfter: 0 },
    ])
  })

  it('says so when the regular charges alone outrun the monthly amount', () => {
    const forecast = buildInvoiceForecast({
      startingBalance: 100,
      monthlyCapIncVat: 50,
      monthlyChargesIncVat: 60,
      firstInvoiceDate: '2026-11-01',
      maxMonths: 6,
    })

    expect(forecast.rows).toHaveLength(6)
    expect(forecast.truncated).toBe(true)
  })

  it('has nothing to show when nothing is waiting or there is no monthly amount', () => {
    expect(
      buildInvoiceForecast({ startingBalance: 0, monthlyCapIncVat: 500, monthlyChargesIncVat: 96, firstInvoiceDate: '2026-11-01' }).rows
    ).toEqual([])
    expect(
      buildInvoiceForecast({ startingBalance: 500, monthlyCapIncVat: 0, monthlyChargesIncVat: 0, firstInvoiceDate: '2026-11-01' }).rows
    ).toEqual([])
  })
})
