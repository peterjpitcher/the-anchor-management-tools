import { describe, expect, it } from 'vitest'
import { buildBookingSheetModel } from '@/lib/table-bookings/booking-sheet'
import { generateBookingOnePagerHTML, renderBookingOnePager } from '@/lib/table-booking-one-pager-template'
import { bookingFacts, christmasOrder } from './fixture'

const BAD_VALUES = ['undefined', 'Invalid Date', 'NaN', 'null']

function expectClean(html: string): void {
  // Strip the stylesheet: CSS has no business being checked for prose, and "null" never appears in it.
  const body = html.replace(/<style>[\s\S]*?<\/style>/g, '')
  for (const bad of BAD_VALUES) expect(body).not.toContain(bad)
}

describe('renderBookingOnePager with fixture data', () => {
  const model = buildBookingSheetModel({ booking: bookingFacts(), order: christmasOrder() })
  const html = renderBookingOnePager(model, { allowPrint: true })

  it('renders with no undefined, Invalid Date, NaN or null', () => {
    expectClean(html)
    expectClean(renderBookingOnePager(buildBookingSheetModel({ booking: bookingFacts({ deposit: { kind: 'none' } }), order: null }), { allowPrint: false }))
  })

  it('puts the sections in order: header, allergy box, kitchen tally, guest table', () => {
    const positions = ['bs-head', 'bs-allergy-title', 'bs-tally-title', 'bs-guests-title'].map((needle) => html.indexOf(needle))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('shows the header facts', () => {
    for (const text of [
      'Fixture Organiser',
      '+447700900000',
      'TB-FIXTURE',
      '7pm',
      'Dining Room 1, Dining Room 2',
      '£60.00 paid, take it off the bill',
      '3 of 6 chosen, 3 missing',
    ]) {
      expect(html).toContain(text)
    }
  })

  it('lists every guest allergy and the seats not answered in the red box', () => {
    const box = html.slice(html.indexOf('bs-allergy-title'), html.indexOf('bs-tally-title'))
    expect(box).toContain('Seat 1, Guest One: Peanuts')
    expect(box).toContain('Not answered:</span> seats 3, 5, 6')
    expect(box).not.toContain('No allergies recorded')
  })

  it('says "No allergies recorded" when there are none', () => {
    const none = renderBookingOnePager(buildBookingSheetModel({ booking: bookingFacts(), order: null }), { allowPrint: true })
    expect(none).toContain('No allergies recorded')
    expect(none).toContain('No food pre-order for this booking')
    expect(none).not.toContain('bs-tally-title')
  })

  it('tallies tiers, dishes, kids mains, extras and what is not chosen', () => {
    const tally = html.slice(html.indexOf('bs-tally-title'), html.indexOf('bs-guests-title'))
    expect(tally).toContain('<span class="bs-key">3 courses:</span> 1')
    expect(tally).toContain('<span class="bs-key">2 courses:</span> 2')
    expect(tally).toContain('<span class="bs-key">1 course:</span> 2')
    expect(tally).toContain('Courses not chosen yet: 1')
    expect(tally).toContain('<span class="bs-count">2 x</span><span>Fixture turkey</span>')
    expect(tally).toContain('Kids mains')
    expect(tally).toContain('Fixture kids turkey')
    expect(tally).toContain('Off the menu, ring the guest')
    expect(tally).toContain('Fixture cheeseboard')
    expect(tally).toContain('Not chosen: 2')
    expect(tally).toContain('Starter or dessert not chosen (2 courses): 1')
  })

  it('builds an accessible guest table with a row per seat', () => {
    expect(html).toContain('<thead>')
    for (const heading of ['Seat', 'Name', 'Courses', 'Starter', 'Main', 'Dessert', 'Extras', 'Allergies', 'Dietary needs']) {
      expect(html).toContain(`<th scope="col">${heading}</th>`)
    }
    expect(html.match(/<th scope="row">/g)).toHaveLength(6)
    // Words, not colour: the missing cell says so, and the allergy says Yes.
    expect(html).toContain('<td class="bs-cell-missing">Not chosen</td>')
    expect(html).toContain('<td class="bs-cell-allergy">Yes: Peanuts</td>')
    expect(html).toContain('<td class="bs-cell-unanswered">Not answered</td>')
  })

  it('escapes what guests typed', () => {
    const hostile = buildBookingSheetModel({
      booking: bookingFacts({ organiserName: '<script>x</script>', notes: 'A & B "quoted"' }),
      order: christmasOrder({
        covers: [
          {
            ...christmasOrder().covers[0],
            guestName: '<img src=x onerror=alert(1)>',
            allergyDetail: '<b>nuts</b>',
          },
        ],
      }),
    })
    const out = renderBookingOnePager(hostile, { allowPrint: true })
    expect(out).not.toContain('<script>x</script>')
    expect(out).not.toContain('<img src=x')
    expect(out).not.toContain('<b>nuts</b>')
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(out).toContain('A &amp; B &quot;quoted&quot;')
  })
})

// Owner decision D14: front of house gets no print. The stylesheet hides the sheet on paper.
describe('print stylesheet', () => {
  const model = buildBookingSheetModel({ booking: bookingFacts(), order: christmasOrder() })

  it('hides the sheet in print for front of house and says to ask a manager', () => {
    const foh = renderBookingOnePager(model, { allowPrint: false })
    expect(foh).toContain('@media print{ .bs-sheet{ display:none !important; }')
    expect(foh).toContain('Ask a manager if you need a printed copy.')
  })

  it('prints the sheet alone, without the page around it, for people who can download', () => {
    const boh = renderBookingOnePager(model, { allowPrint: true })
    expect(boh).not.toContain('.bs-sheet{ display:none')
    expect(boh).toContain('@media print{ body *{ visibility:hidden; } .bs-sheet, .bs-sheet *{ visibility:visible; } }')
    expect(boh).not.toContain('bs-print-refusal">')
  })
})

describe('generateBookingOnePagerHTML', () => {
  it('wraps the same sheet in an A4 document with the logo and footer', () => {
    const model = buildBookingSheetModel({ booking: bookingFacts(), order: christmasOrder() })
    const html = generateBookingOnePagerHTML(model, {
      logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      generatedAt: '17 December 2026 at 4:05pm',
    })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('@page{ size:A4 portrait; }')
    expect(html).toContain('<img class="bs-logo" src="data:image/png;base64,iVBORw0KGgo=" alt="The Anchor">')
    expect(html).toContain('Generated at 17 December 2026 at 4:05pm')
    expect(html).toContain(renderBookingOnePager(model, { allowPrint: true, forPdf: true, logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=', generatedAt: '17 December 2026 at 4:05pm' }))
    expect(html).not.toContain('@media print')
    expectClean(html)
  })
})
