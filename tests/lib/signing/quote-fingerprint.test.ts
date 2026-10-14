// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { quoteContentFingerprint, type QuoteContentForFingerprint } from '@/lib/signing/documents/quote-fingerprint'

/**
 * A client accepts the quote they were shown. The fingerprint is how the app tells, when the
 * acceptance arrives, whether the quote is still that quote: a description or a note can change
 * while the total stays the same.
 */

type Row = Record<string, unknown>

function line(overrides: Row = {}): Row {
  return {
    id: 'li-1',
    quote_id: 'q-1',
    catalog_item_id: null,
    description: 'House wine, case of six',
    quantity: 3,
    unit_price: 25.5,
    discount_percentage: 10,
    vat_rate: 20,
    subtotal_amount: 76.5,
    discount_amount: 7.65,
    vat_amount: 13.77,
    total_amount: 82.62,
    created_at: '2026-10-01T09:00:00.000Z',
    ...overrides,
  }
}

const SECOND_LINE = line({ id: 'li-2', description: 'Bar snacks', quantity: 1, unit_price: 40, discount_percentage: 0, subtotal_amount: 40, discount_amount: 0, vat_amount: 8, total_amount: 48 })

function quote(overrides: Row = {}): Row {
  return {
    id: 'q-1',
    quote_number: 'QT-2026-0001',
    vendor_id: 'vendor-1',
    quote_date: '2026-10-01',
    valid_until: '2026-10-31',
    reference: 'Enquiry 88',
    status: 'sent',
    quote_discount_percentage: 0,
    subtotal_amount: 116.5,
    discount_amount: 7.65,
    vat_amount: 21.77,
    total_amount: 130.62,
    notes: 'Delivery to the cellar door.',
    internal_notes: 'Margin is thin on the wine.',
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    line_items: [line(), SECOND_LINE],
    ...overrides,
  }
}

/** The rows are built loosely, as the database hands them over, and read as the function reads them. */
function fingerprint(row: Row): string {
  return quoteContentFingerprint(row as QuoteContentForFingerprint)
}

const ORIGINAL = fingerprint(quote())

describe('the fingerprint of what a quote says', () => {
  it('is a SHA-256 in lower case hex', () => {
    expect(ORIGINAL).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is the same every time for the same quote', () => {
    expect(fingerprint(quote())).toBe(ORIGINAL)
    expect(fingerprint(JSON.parse(JSON.stringify(quote())) as Row)).toBe(ORIGINAL)
  })

  it('does not depend on the order the lines come back in', () => {
    expect(fingerprint(quote({ line_items: [SECOND_LINE, line()] }))).toBe(ORIGINAL)
  })

  it('reads an amount the same whether it arrives as a number or as text', () => {
    const asText = quote({
      quote_discount_percentage: '0',
      subtotal_amount: '116.50',
      discount_amount: '7.65',
      vat_amount: '21.77',
      total_amount: '130.62',
      line_items: [
        line({ quantity: '3', unit_price: '25.50', discount_percentage: '10.00', vat_rate: '20', total_amount: '82.62' }),
        line({ ...SECOND_LINE, quantity: '1.000', unit_price: '40.00', discount_percentage: '0.00', vat_rate: '20.00', total_amount: '48.00' }),
      ],
    })

    expect(fingerprint(asText)).toBe(ORIGINAL)
  })

  it('reads a date the same with or without a time on the end', () => {
    expect(fingerprint(quote({ quote_date: '2026-10-01T00:00:00+00:00', valid_until: '2026-10-31T00:00:00.000Z' }))).toBe(ORIGINAL)
  })

  it('leaves out what the client never sees or agrees to', () => {
    expect(fingerprint(quote({ internal_notes: 'Changed our minds about the margin.' }))).toBe(ORIGINAL)
    expect(fingerprint(quote({ internal_notes: null }))).toBe(ORIGINAL)
    // Sending a draft for acceptance moves it to Sent. That is not a change to the quote.
    expect(fingerprint(quote({ status: 'draft' }))).toBe(ORIGINAL)
    expect(fingerprint(quote({ status: 'accepted' }))).toBe(ORIGINAL)
  })

  it('leaves out the bookkeeping around a quote and its lines', () => {
    const resaved = quote({
      id: 'q-9',
      created_at: '2026-10-02T09:00:00.000Z',
      updated_at: '2026-10-05T17:30:00.000Z',
      converted_to_invoice_id: null,
      // Saving a quote writes its lines again, with new ids.
      line_items: [line({ id: 'li-77', quote_id: 'q-9', created_at: '2026-10-05T17:30:00.000Z' }), { ...SECOND_LINE, id: 'li-78' }],
    })

    expect(fingerprint(resaved)).toBe(ORIGINAL)
  })

  it('reads an amount that is missing, empty or null as nought', () => {
    const nought = fingerprint(quote({ discount_amount: 0 }))

    expect(nought).not.toBe(ORIGINAL)
    for (const empty of [null, undefined, '', '0', '0.00']) {
      expect(fingerprint(quote({ discount_amount: empty })), JSON.stringify(empty)).toBe(nought)
    }
  })

  it('reads every amount on the quote and on its lines that way', () => {
    const zeroes = quote({
      quote_discount_percentage: 0,
      subtotal_amount: 0,
      discount_amount: 0,
      vat_amount: 0,
      total_amount: 0,
      line_items: [line({ quantity: 0, unit_price: 0, discount_percentage: 0, vat_rate: 0, total_amount: 0 })],
    })
    const empties = quote({
      quote_discount_percentage: null,
      subtotal_amount: undefined,
      discount_amount: '',
      vat_amount: null,
      total_amount: null,
      line_items: [line({ quantity: null, unit_price: undefined, discount_percentage: '', vat_rate: null, total_amount: null })],
    })

    expect(fingerprint(empties)).toBe(fingerprint(zeroes))
  })

  it('gives the quote as it is read for sending, with empty amounts turned to nought, the fingerprint of the stored row', () => {
    // As stored: an amount nobody filled in. As read for sending: the same amount as 0.
    const stored = quote({ discount_amount: null, vat_amount: null })
    const readForSending = quote({ discount_amount: 0, vat_amount: 0 })

    expect(fingerprint(readForSending)).toBe(fingerprint(stored))
  })

  it('still tells nought from an amount', () => {
    expect(fingerprint(quote({ discount_amount: null }))).not.toBe(fingerprint(quote({ discount_amount: 0.01 })))
    expect(fingerprint(quote({ total_amount: null }))).not.toBe(ORIGINAL)
  })

  it('treats a note or reference that is missing, empty or null as the same thing', () => {
    const none = fingerprint(quote({ notes: null, reference: null }))

    expect(fingerprint(quote({ notes: '', reference: '' }))).toBe(none)
    expect(fingerprint(quote({ notes: undefined, reference: undefined }))).toBe(none)
    expect(none).not.toBe(ORIGINAL)
  })

  it('treats a quote with no lines the same however that is written', () => {
    const none = fingerprint(quote({ line_items: [] }))

    expect(fingerprint(quote({ line_items: null }))).toBe(none)
    expect(fingerprint(quote({ line_items: undefined }))).toBe(none)
    expect(none).not.toBe(ORIGINAL)
  })
})

describe('what changes the fingerprint of a quote', () => {
  it('changes when a line is reworded and every figure stays the same', () => {
    const reworded = quote({ line_items: [line({ description: 'House wine, case of twelve' }), SECOND_LINE] })

    expect(fingerprint(reworded)).not.toBe(ORIGINAL)
  })

  it('changes when the notes are reworded and every figure stays the same', () => {
    expect(fingerprint(quote({ notes: 'Delivery to the front door.' }))).not.toBe(ORIGINAL)
  })

  it.each([
    ['the quote number', { quote_number: 'QT-2026-0002' }],
    ['the quote date', { quote_date: '2026-10-02' }],
    ['the valid-until date', { valid_until: '2026-11-30' }],
    ['the reference', { reference: 'Enquiry 89' }],
    ['the notes', { notes: 'Delivery to the cellar door. Payment on delivery.' }],
    ['who it is for', { vendor_id: 'vendor-2' }],
    ['the quote discount', { quote_discount_percentage: 5 }],
    ['the subtotal', { subtotal_amount: 116.51 }],
    ['the discount', { discount_amount: 7.66 }],
    ['the VAT', { vat_amount: 21.78 }],
    ['the total', { total_amount: 130.63 }],
  ] as Array<[string, Row]>)('changes when %s changes', (_what, change) => {
    expect(fingerprint(quote(change))).not.toBe(ORIGINAL)
  })

  it.each([
    ['the description', { description: 'House wine, case of six (red)' }],
    ['the quantity', { quantity: 4 }],
    ['the unit price', { unit_price: 25.49 }],
    ['the line discount', { discount_percentage: 12.5 }],
    ['the VAT rate', { vat_rate: 0 }],
    ['the line total', { total_amount: 82.63 }],
  ] as Array<[string, Row]>)('changes when %s of a line changes', (_what, change) => {
    expect(fingerprint(quote({ line_items: [line(change), SECOND_LINE] }))).not.toBe(ORIGINAL)
  })

  it('changes when a line is added, removed or repeated', () => {
    const third = line({ id: 'li-3', description: 'Glass hire', quantity: 50, unit_price: 0.2, discount_percentage: 0, total_amount: 12 })

    expect(fingerprint(quote({ line_items: [line(), SECOND_LINE, third] }))).not.toBe(ORIGINAL)
    expect(fingerprint(quote({ line_items: [line()] }))).not.toBe(ORIGINAL)
    expect(fingerprint(quote({ line_items: [line(), SECOND_LINE, SECOND_LINE] }))).not.toBe(ORIGINAL)
  })

  it('changes when two lines swap their descriptions, though the same words and figures are all still there', () => {
    const swapped = quote({
      line_items: [line({ description: SECOND_LINE.description }), { ...SECOND_LINE, description: line().description }],
    })

    expect(fingerprint(swapped)).not.toBe(ORIGINAL)
  })

  it('gives a different fingerprint to each of several different edits', () => {
    const edits = [
      quote({ notes: 'A' }),
      quote({ notes: 'B' }),
      quote({ reference: 'A' }),
      quote({ quote_number: 'A' }),
      quote({ line_items: [line({ description: 'A' }), SECOND_LINE] }),
      quote({ line_items: [line(), { ...SECOND_LINE, description: 'A' }] }),
    ].map(fingerprint)

    expect(new Set([ORIGINAL, ...edits]).size).toBe(edits.length + 1)
  })
})
