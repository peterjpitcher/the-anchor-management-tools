import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  generateTableBookingSheetsHTML,
  type TableBookingSheetData,
  type TableBookingSheetPreorder,
} from '@/lib/table-booking-sheet-template'
import { PREORDER_ADDON_STAFF_NOTE } from '@/types/preorders'

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
    requirements: [],
    generatedAt: '16 July 2026 at 7:32pm',
    ...overrides,
  }
}

function makePreorder(
  overrides: Partial<TableBookingSheetPreorder> = {}
): TableBookingSheetPreorder {
  return {
    allergies: [],
    covers: [
      {
        seatLabel: 'Seat 1 · Jo Bloggs',
        courses: [
          { courseLabel: 'Starter', itemName: 'Parsnip soup' },
          { courseLabel: 'Main', itemName: 'Roast turkey' },
        ],
        dietaryNote: null,
      },
    ],
    ...overrides,
  }
}

function countPages(html: string): number {
  return html.match(/<section class="page">/g)?.length ?? 0
}

function countFoodPages(html: string): number {
  return html.match(/<section class="food-page">/g)?.length ?? 0
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
            requirements: [SCRIPT],
            generatedAt: SCRIPT,
          },
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).not.toContain('<script>')
      expect(countOccurrences(html, '&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(9)
    })
  })

  describe('seating needs', () => {
    it('should omit the seating-needs block when there are no requirements', () => {
      const html = generateTableBookingSheetsHTML([makeSheet()], { logoDataUrl: LOGO })

      expect(html).not.toContain('Seating needs')
      expect(html).not.toContain('class="needs"')
    })

    it('should render step-free and high-chair needs joined on one line', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ requirements: ['Step-free table', 'High chair ×2'] })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Seating needs')
      expect(html).toContain('Step-free table · High chair ×2')
    })

    it('should render the block only on pages whose booking has requirements', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({ bookingRef: 'TB-0001' }),
          makeSheet({ bookingRef: 'TB-0002', requirements: ['Step-free table'] }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(countOccurrences(html, 'Seating needs')).toBe(1)
    })

    it('should escape hostile characters supplied in a requirement item', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ requirements: ['<script>alert(1)</script>'] })],
        { logoDataUrl: LOGO }
      )

      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
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

  // The fixture was generated from the template as it stood BEFORE seasonal pre-orders existed. It is
  // the only proof that adding the food page did not quietly change every sheet the pub prints today,
  // and it covers the stylesheet as well as the markup. If a deliberate change to the ordinary sheet
  // is ever made, regenerate the fixture in the same commit and say so in the message.
  describe('baseline: an ordinary sheet is byte-identical to what we printed before pre-orders', () => {
    const BASELINE = readFileSync(
      path.join(__dirname, '__fixtures__', 'table-booking-sheet-baseline.html'),
      'utf8'
    )

    const baselineSheets: TableBookingSheetData[] = [
      makeSheet(),
      makeSheet({
        bookingRef: 'TB-0002',
        customerName: "O'Neill & Sons",
        startTime: '1:15pm',
        partySize: '12',
        tableLabel: 'Outside',
        status: 'Pending payment',
        requirements: ['Step-free table', 'High chair ×2'],
      }),
    ]

    it('should reproduce the recorded baseline byte for byte', () => {
      expect(generateTableBookingSheetsHTML(baselineSheets, { logoDataUrl: LOGO })).toBe(BASELINE)
    })

    it('should emit no pre-order markup or styles at all when no sheet carries a pre-order', () => {
      const html = generateTableBookingSheetsHTML(baselineSheets, { logoDataUrl: LOGO })

      expect(countFoodPages(html)).toBe(0)
      expect(html).not.toContain('.food-page')
      expect(html).not.toContain('class="seat')
      expect(html).not.toContain('class="alerts')
    })

    it('should leave the ordinary page untouched on a booking that also has a pre-order', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ preorder: makePreorder() })],
        { logoDataUrl: LOGO }
      )
      const bookingPage = html.slice(
        html.indexOf('<section class="page">'),
        html.indexOf('<section class="food-page">')
      )

      expect(countPages(html)).toBe(1)
      expect(countFoodPages(html)).toBe(1)
      expect(bookingPage.toLowerCase()).not.toContain('allerg')
      expect(bookingPage.toLowerCase()).not.toContain('dietary')
    })
  })

  describe('pre-order food page', () => {
    it('should list every seat with its name and its courses in the order supplied', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [
                {
                  seatLabel: 'Seat 1 · Jo Bloggs',
                  courses: [
                    { courseLabel: 'Starter', itemName: 'Parsnip soup' },
                    { courseLabel: 'Main', itemName: 'Roast turkey' },
                    { courseLabel: 'Dessert', itemName: 'Christmas pudding' },
                  ],
                  dietaryNote: null,
                },
                {
                  seatLabel: 'Seat 2',
                  courses: [{ courseLabel: 'Main', itemName: 'Nut roast' }],
                  dietaryNote: null,
                },
              ],
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Kitchen pre-order')
      expect(countOccurrences(html, 'class="seat"')).toBe(2)
      expect(html).toContain('Seat 1 · Jo Bloggs')
      expect(html).toContain('Seat 2')
      expect(html.indexOf('Parsnip soup')).toBeLessThan(html.indexOf('Roast turkey'))
      expect(html.indexOf('Roast turkey')).toBeLessThan(html.indexOf('Christmas pudding'))
      expect(html).toContain('<span class="seat-course-label">Main</span>Nut roast')
    })

    it('should say so plainly when a seat has chosen nothing rather than printing a blank', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [{ seatLabel: 'Seat 3', courses: [], dietaryNote: null }],
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Nothing chosen yet')
    })

    // Spec section 6 item 3. Dropping either source would be the most dangerous regression here.
    it('should show booking allergies and per-seat dietary notes, each labelled', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              allergies: ['Nuts', 'Shellfish'],
              covers: [
                {
                  seatLabel: 'Seat 1 · Jo Bloggs',
                  courses: [{ courseLabel: 'Main', itemName: 'Roast turkey' }],
                  dietaryNote: 'No dairy please',
                },
              ],
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Allergies, whole booking')
      expect(html).toContain('Nuts · Shellfish')
      expect(html).toContain('Dietary requirement, this guest')
      expect(html).toContain('No dairy please')
    })

    it('should still print the allergy line, marked as empty, when none are recorded', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ preorder: makePreorder({ allergies: [] }) })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Allergies, whole booking')
      expect(html).toContain('None recorded')
    })

    it('should omit the dietary block for a seat that gave no note', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [
                {
                  seatLabel: 'Seat 1',
                  courses: [{ courseLabel: 'Main', itemName: 'Roast turkey' }],
                  dietaryNote: null,
                },
                {
                  seatLabel: 'Seat 2',
                  courses: [{ courseLabel: 'Main', itemName: 'Nut roast' }],
                  dietaryNote: 'Coeliac',
                },
              ],
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(countOccurrences(html, 'Dietary requirement, this guest')).toBe(1)
    })

    it('should escape hostile characters in seat labels, dish names, notes and allergies', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: {
              allergies: ['<script>alert(1)</script>'],
              covers: [
                {
                  seatLabel: '<script>alert(1)</script>',
                  courses: [
                    {
                      courseLabel: '<script>alert(1)</script>',
                      itemName: '<script>alert(1)</script>',
                    },
                  ],
                  dietaryNote: '<script>alert(1)</script>',
                },
              ],
            },
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).not.toContain('<script>')
      expect(html).not.toContain('</script>')
      expect(countOccurrences(html, '&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(5)
    })

    it('should let a long party flow onto another page rather than clipping the last seats', () => {
      const covers = Array.from({ length: 24 }, (_unused, index) => ({
        seatLabel: `Seat ${index + 1}`,
        courses: [{ courseLabel: 'Main', itemName: `Dish ${index + 1}` }],
        dietaryNote: null,
      }))
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ partySize: '24', preorder: makePreorder({ covers }) })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Seat 24')
      expect(html).toContain('Dish 24')

      const rule = html.slice(html.indexOf('.food-page{'), html.indexOf('}', html.indexOf('.food-page{')))
      expect(rule).toContain('min-height:297mm')
      expect(rule).not.toContain('overflow:hidden')
      expect(html).toContain('page-break-inside:avoid')
    })

    it('should give a food page only to the bookings that have a pre-order', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({ bookingRef: 'TB-0001' }),
          makeSheet({ bookingRef: 'TB-0002', preorder: makePreorder() }),
          makeSheet({ bookingRef: 'TB-0003' }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(countPages(html)).toBe(3)
      expect(countFoodPages(html)).toBe(1)
      expect(countOccurrences(html, 'Kitchen pre-order')).toBe(1)
    })
  })

  // Add-ons are extras the guest has ON TOP of their meal, charged on the night. The cheeseboard sat
  // on the menu as a dessert, so ticking it cost the guest their pudding: these tests exist to prove
  // the kitchen page can never present one as a course again.
  describe('pre-order add-ons', () => {
    const CHEESE_SEAT = {
      seatLabel: 'Seat 1 · Jo Bloggs',
      courses: [
        { courseLabel: 'Main', itemName: 'Roast turkey' },
        { courseLabel: 'Dessert', itemName: 'Christmas pudding' },
      ],
      addons: [
        { itemName: 'Farmhouse cheeseboard', priceLabel: '£8.50' },
        { itemName: 'Port pairing', priceLabel: '£4.20' },
      ],
      addonTotal: { count: 2, totalLabel: '£12.70', hasUnpriced: false },
      dietaryNote: null,
    }

    it('should render add-ons in their own block, never as another course line', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ preorder: makePreorder({ covers: [CHEESE_SEAT] }) })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('class="seat-addons"')
      expect(html).toContain('Add-ons, extra to the courses')
      expect(html).toContain('Farmhouse cheeseboard')
      // The dessert line is still the guest's pudding, and the cheeseboard is not one of them.
      expect(html).toContain('<span class="seat-course-label">Dessert</span>Christmas pudding')
      expect(html).not.toContain(
        '<span class="seat-course-label">Dessert</span>Farmhouse cheeseboard'
      )
      expect(countOccurrences(html, 'class="seat-course"')).toBe(2)
    })

    it('should print the price beside each add-on and the seat total below them', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ preorder: makePreorder({ covers: [CHEESE_SEAT] }) })],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('<span class="seat-addon-price">£8.50</span>')
      expect(html).toContain('<span class="seat-addon-price">£4.20</span>')
      expect(html).toContain('Seat add-on total £12.70')
    })

    it('should show the whole booking total with the staff wording verbatim', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [CHEESE_SEAT],
              addonTotal: { count: 2, totalLabel: '£12.70', hasUnpriced: false },
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Add-ons, whole booking')
      expect(html).toContain('2 add-ons · £12.70')
      expect(html).toContain(PREORDER_ADDON_STAFF_NOTE)
    })

    it('should say "add-on" in the singular when only one is ticked', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [CHEESE_SEAT],
              addonTotal: { count: 1, totalLabel: '£8.50', hasUnpriced: false },
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('1 add-on · £8.50')
      expect(html).not.toContain('1 add-ons')
    })

    // Every Christmas price is null today, so this is the normal case rather than an edge one.
    it('should flag an unpriced add-on rather than letting the total read as final', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [
                {
                  seatLabel: 'Seat 1',
                  courses: [{ courseLabel: 'Main', itemName: 'Roast turkey' }],
                  addons: [{ itemName: 'Farmhouse cheeseboard', priceLabel: 'Price on the day' }],
                  addonTotal: { count: 1, totalLabel: '£0.00', hasUnpriced: true },
                  dietaryNote: null,
                },
              ],
              addonTotal: { count: 1, totalLabel: '£0.00', hasUnpriced: true },
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Price on the day')
      expect(html).toContain('Some of these are not priced yet, so this is not the whole of it.')
      expect(html).toContain(
        `${PREORDER_ADDON_STAFF_NOTE} Some of them are not priced yet, so this figure is not the whole charge.`
      )
    })

    it('should omit the caveat entirely when every add-on carries a price', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [CHEESE_SEAT],
              addonTotal: { count: 2, totalLabel: '£12.70', hasUnpriced: false },
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).not.toContain('not priced yet')
      expect(html).toContain(`<p class="addons-note">${PREORDER_ADDON_STAFF_NOTE}</p>`)
    })

    it('should emit no add-on markup at all on a pre-order where nobody ticked one', () => {
      const html = generateTableBookingSheetsHTML(
        [makeSheet({ preorder: makePreorder() })],
        { logoDataUrl: LOGO }
      )

      expect(countFoodPages(html)).toBe(1)
      expect(html).not.toContain('class="seat-addons"')
      expect(html).not.toContain('class="addons"')
      expect(html).not.toContain('Add-on')
    })

    it('should give the add-on block only to the seats that ticked something', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [
                CHEESE_SEAT,
                {
                  seatLabel: 'Seat 2',
                  courses: [{ courseLabel: 'Main', itemName: 'Nut roast' }],
                  dietaryNote: null,
                },
              ],
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(countOccurrences(html, 'class="seat"')).toBe(2)
      expect(countOccurrences(html, 'class="seat-addons"')).toBe(1)
    })

    // The most dangerous regression this feature could cause: spec section 6 item 3.
    it('should still show booking allergies and per-seat dietary notes alongside add-ons', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              allergies: ['Nuts', 'Shellfish'],
              covers: [{ ...CHEESE_SEAT, dietaryNote: 'No dairy please' }],
              addonTotal: { count: 2, totalLabel: '£12.70', hasUnpriced: false },
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Allergies, whole booking')
      expect(html).toContain('Nuts · Shellfish')
      expect(html).toContain('Dietary requirement, this guest')
      expect(html).toContain('No dairy please')
      expect(html).toContain('Farmhouse cheeseboard')
    })

    it('should escape hostile characters in add-on names, prices and totals', () => {
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [
                {
                  seatLabel: 'Seat 1',
                  courses: [],
                  addons: [
                    {
                      itemName: '<script>alert(1)</script>',
                      priceLabel: '<script>alert(1)</script>',
                    },
                  ],
                  addonTotal: {
                    count: 1,
                    totalLabel: '<script>alert(1)</script>',
                    hasUnpriced: false,
                  },
                  dietaryNote: null,
                },
              ],
              addonTotal: {
                count: 1,
                totalLabel: '<script>alert(1)</script>',
                hasUnpriced: false,
              },
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).not.toContain('<script>')
      expect(html).not.toContain('</script>')
      expect(countOccurrences(html, '&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(4)
    })

    it('should let a long add-on list flow rather than clipping it', () => {
      const addons = Array.from({ length: 12 }, (_unused, index) => ({
        itemName: `Extra ${index + 1}`,
        priceLabel: '£1.00',
      }))
      const html = generateTableBookingSheetsHTML(
        [
          makeSheet({
            preorder: makePreorder({
              covers: [
                {
                  seatLabel: 'Seat 1',
                  courses: [{ courseLabel: 'Main', itemName: 'Roast turkey' }],
                  addons,
                  addonTotal: { count: 12, totalLabel: '£12.00', hasUnpriced: false },
                  dietaryNote: null,
                },
              ],
            }),
          }),
        ],
        { logoDataUrl: LOGO }
      )

      expect(html).toContain('Extra 12')
      const rule = html.slice(
        html.indexOf('.seat-addon{'),
        html.indexOf('}', html.indexOf('.seat-addon{'))
      )
      expect(rule).not.toContain('overflow:hidden')
      expect(rule).toContain('overflow-wrap:anywhere')
    })
  })
})
