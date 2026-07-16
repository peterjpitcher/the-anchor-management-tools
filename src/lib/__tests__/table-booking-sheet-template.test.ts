import { describe, it, expect } from 'vitest'
import {
  generateTableBookingSheetsHTML,
  type TableBookingSheetData,
} from '@/lib/table-booking-sheet-template'

const LOGO = 'data:image/png;base64,iVBORw0KGgo='

function makeSheet(overrides: Partial<TableBookingSheetData> = {}): TableBookingSheetData {
  return {
    bookingRef: 'TB-0001',
    customerName: 'Jo Bloggs',
    bookingDate: 'Thursday, 16 July 2026',
    startTime: '7:30pm',
    partySize: '6',
    tableLabel: 'Window, 6',
    status: 'Booked',
    generatedAt: '16 July 2026 at 7:32pm',
    ...overrides,
  }
}

function countPages(html: string): number {
  return html.match(/<section class="page">/g)?.length ?? 0
}

function countOccurrences(html: string, needle: string): number {
  return html.split(needle).length - 1
}

describe('generateTableBookingSheetsHTML', () => {
  describe('pagination structure', () => {
    it('should render exactly one page section per sheet when given 3 sheets', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({ bookingRef: 'TB-0001' }),
          makeSheet({ bookingRef: 'TB-0002' }),
          makeSheet({ bookingRef: 'TB-0003' }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(countPages(html)).toBe(3)
      expect(html).toContain('TB-0001')
      expect(html).toContain('TB-0002')
      expect(html).toContain('TB-0003')
    })

    it('should include the last-child page-break reset so no trailing blank page is emitted', () => {
      const html = generateTableBookingSheetsHTML([makeSheet()], { logoDataUrl: LOGO })

      expect(html).toContain('page-break-after:always')
      expect(html).toContain('break-after:page')
      expect(html).toContain('.page:last-child{ page-break-after:auto; break-after:auto; }')
    })

    it('should render an A4 portrait page rule and the zero-margin @page block', () => {
      const html = generateTableBookingSheetsHTML([makeSheet()], { logoDataUrl: LOGO })

      expect(html).toContain('@page{ size:A4 portrait; margin:0; }')
      expect(html).toContain('width:210mm')
      expect(html).toContain('height:297mm')
    })

    it('should render a document shell with no pages when given an empty sheet list', () => {
      const html = generateTableBookingSheetsHTML([], { logoDataUrl: LOGO })

      expect(html).toContain('<!DOCTYPE html>')
      expect(countPages(html)).toBe(0)
    })

    it('should embed the logo data URL and the Google Fonts link block', () => {
      const html = generateTableBookingSheetsHTML([makeSheet()], { logoDataUrl: LOGO })

      expect(html).toContain(`src="${LOGO}"`)
      expect(html).toContain('https://fonts.googleapis.com/css2?family=DM+Serif+Display')
      expect(html).toContain('rel="preconnect"')
    })
  })

  describe('escaping', () => {
    const HOSTILE = 'Ben & "Jo" <VIP>'
    const SCRIPT = '<script>alert(1)</script>'

    const fields: Array<keyof TableBookingSheetData> = [
      'bookingRef',
      'customerName',
      'bookingDate',
      'startTime',
      'partySize',
      'tableLabel',
      'status',
      'generatedAt',
    ]

    it.each(fields)('should escape hostile characters supplied in %s', (field) => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ [field]: HOSTILE })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Ben &amp; &quot;Jo&quot; &lt;VIP&gt;')
      expect(html).not.toContain('Ben & "Jo" <VIP>')
      expect(html).not.toContain('<VIP>')
    })

    it.each(fields)('should neutralise an injected script tag supplied in %s', (field) => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ [field]: SCRIPT })],
        { logoDataUrl: LOGO }
      )

      expect(html).not.toContain('<script>')
      expect(html).not.toContain('</script>')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    })

    it('should escape single quotes and ampersands without double-escaping the ampersand', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ customerName: "O'Neill & Sons" })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('O&#39;Neill &amp; Sons')
      expect(html).not.toContain('&amp;amp;')
    })

    it('should escape every hostile field at once without producing raw markup', () => {
      const html = generateTableBookingSheetsHTML(
        [
          {
            bookingRef: SCRIPT,
            customerName: SCRIPT,
            bookingDate: SCRIPT,
            startTime: SCRIPT,
            partySize: SCRIPT,
            tableLabel: SCRIPT,
            status: SCRIPT,
            generatedAt: SCRIPT,
          },
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).not.toContain('<script>')
      expect(countOccurrences(html, '&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(8)
    })
  })

  describe('facts grid', () => {
    it.each(['Outside', 'Unassigned', 'Window, 6'])(
      'should render the table fact when the label is %s',
      (tableLabel) => {
        const html = generateTableBookingSheetsHTML(
          [makeSheet({ tableLabel })],
          { logoDataUrl: LOGO }
        )

        expect(html).toContain('<p class="fact-label">Table</p>')
        expect(html).toContain(`<p class="fact-value table-value">${tableLabel}</p>`)
      }
    )

    it('should render the Time and Party size facts alongside the Table fact', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ startTime: '1:15pm', partySize: '12' })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('<p class="fact-label">Time</p>')
      expect(html).toContain('<p class="fact-value">1:15pm</p>')
      expect(html).toContain('<p class="fact-label">Party size</p>')
      expect(html).toContain('<span>12</span>')
      expect(countOccurrences(html, 'class="fact-label"')).toBe(3)
    })

    it('should render the pre-formatted status verbatim rather than deriving it', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ status: 'Pending payment' })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('<p class="state-label">Status</p>')
      expect(html).toContain('<p class="status">Pending payment</p>')
    })

    it('should render the customer name and booking reference exactly as supplied', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ customerName: 'Walk-in guest', bookingRef: 'TB-9999' })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('<p class="res-label">Reserved for</p>')
      expect(html).toContain('<p class="customer-name">Walk-in guest</p>')
      expect(html).toContain('<span class="booking-ref">TB-9999</span>')
    })
  })

  describe('footer', () => {
    it('should render the generated-at line and the source-of-truth line on every page', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({ bookingRef: 'TB-0001' }),
          makeSheet({ bookingRef: 'TB-0002' }),
          makeSheet({ bookingRef: 'TB-0003' }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(countPages(html)).toBe(3)
      expect(countOccurrences(html, 'Generated at 16 July 2026 at 7:32pm')).toBe(3)
      expect(countOccurrences(html, 'Live system is the source of truth')).toBe(3)
    })
  })

  describe('no silent clipping (D-8)', () => {
    it('should never use -webkit-line-clamp anywhere in the generated CSS', () => {
      const html = generateTableBookingSheetsHTML([makeSheet()], { logoDataUrl: LOGO })

      expect(html).not.toContain('-webkit-line-clamp')
      expect(html).not.toContain('line-clamp')
      expect(html).not.toContain('-webkit-box-orient')
    })

    it('should not apply overflow:hidden or text-overflow to any required-fact selector', () => {
      const html = generateTableBookingSheetsHTML([makeSheet()], { logoDataUrl: LOGO })

      const requiredFactSelectors = [
        '.customer-name{',
        '.table-value{',
        '.status{',
        '.booking-ref{',
        '.fact-value{',
      ]

      for (const selector of requiredFactSelectors) {
        const start = html.indexOf(selector)
        expect(start, `${selector} rule should exist`).toBeGreaterThan(-1)
        const rule = html.slice(start, html.indexOf('}', start))
        expect(rule, `${selector} must not clip`).not.toContain('overflow:hidden')
        expect(rule, `${selector} must not clip`).not.toContain('text-overflow')
        expect(rule, `${selector} must wrap long values`).toContain('overflow-wrap:anywhere')
        expect(rule, `${selector} must wrap long values`).toContain('word-break:break-word')
      }
    })

    it('should render a pathologically long customer name in full', () => {
      const longName = 'Bartholomew'.repeat(30)
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ customerName: longName })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain(longName)
    })

    it('should render a long multi-table label in full', () => {
      const longTables = 'Window, Snug, Fireside, Garden 1, Garden 2, Garden 3, Bar 10, Bar 12'
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ tableLabel: longTables })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain(longTables)
    })
  })

  describe('no notes (D-3)', () => {
    it('should not render any notes or special-requirements content passed alongside the sheet', () => {
      const secret = 'Nut allergy on table 6 — check every plate before service'
      // Deliberately smuggle an extra property past the interface to prove the
      // template reads only the eight contracted fields and can never leak notes.
      const sheet = {
        ...makeSheet(),
        specialRequirements: secret,
        notes: secret,
      } as TableBookingSheetData

      const html = generateTableBookingSheetsHTML([sheet], { logoDataUrl: LOGO })

      expect(html).not.toContain(secret)
      expect(html).not.toContain('Nut allergy')
    })

    it('should not include any notes, allergy, dietary or requirements labels in the markup', () => {
      const html = generateTableBookingSheetsHTML([makeSheet()], { logoDataUrl: LOGO })

      expect(html.toLowerCase()).not.toContain('notes')
      expect(html.toLowerCase()).not.toContain('special requirement')
      expect(html.toLowerCase()).not.toContain('allerg')
      expect(html.toLowerCase()).not.toContain('dietary')
    })

    it('should not include a QR code, price, payment or attendee block', () => {
      const html = generateTableBookingSheetsHTML([makeSheet()], { logoDataUrl: LOGO })

      // Assert on MARKUP, not free-text substrings of the whole document: the real logo's base64
      // contains the letters "qr", and bookingDate legitimately reads "Sunday, 19 July 2026" on
      // the venue's busiest day — substring checks would fail for entirely innocent reasons.
      expect(html).not.toContain('class="qr')
      expect(html).not.toContain('qr-')
      expect(html).not.toContain('promo')
      expect(html).not.toContain('pay-label')
      expect(html).not.toContain('Booking total')
      expect(html.toLowerCase()).not.toContain('attendee')
    })
  })
})
