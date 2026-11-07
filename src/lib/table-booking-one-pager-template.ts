import { STAFF } from '@/lib/brand/palette'
import type {
  BookingSheetCell,
  BookingSheetCourseTally,
  BookingSheetDishCount,
  BookingSheetModel,
  BookingSheetSeatRow,
  BookingSheetTally,
} from '@/lib/table-bookings/booking-sheet'

/**
 * The per-booking one-pager's markup (owner decision D14). One template for both outputs: the staff
 * screen at /table-bookings/<id>/sheet injects `renderBookingOnePager`, and the PDF route wraps the
 * same fragment in `generateBookingOnePagerHTML`. Every value comes pre-formatted from the model in
 * src/lib/table-bookings/booking-sheet.ts and is escaped here.
 *
 * Styles are scoped under `.bs-sheet` so they cannot leak into the app around the screen view.
 * Nothing relies on colour alone: every missing course says "Not chosen", every allergy says "Yes".
 */

export interface BookingOnePagerOptions {
  /** The Anchor mark, for the PDF. The screen sits inside the app's own chrome and has none. */
  logoDataUrl?: string
  /**
   * False for front of house (D14): the sheet hides itself when printed and says to ask a manager,
   * so the browser's print does not hand them a paper copy.
   */
  allowPrint: boolean
  /** Compact type for the A4 PDF. */
  forPdf?: boolean
  /** Pre-formatted London timestamp for the footer, e.g. "17 December 2026 at 4:05pm". */
  generatedAt?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function bookingOnePagerStyles(options: Pick<BookingOnePagerOptions, 'allowPrint' | 'forPdf'>): string {
  const base = `
.bs-sheet{ color:${STAFF.text}; background:${STAFF.surface}; font-size:${options.forPdf ? '12px' : '16px'}; line-height:1.45; max-width:1100px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.bs-sheet *{ box-sizing:border-box; }
.bs-sheet h1,.bs-sheet h2,.bs-sheet h3,.bs-sheet p,.bs-sheet ul,.bs-sheet dl,.bs-sheet dd{ margin:0; padding:0; }
.bs-sheet ul{ list-style:none; }
.bs-logo{ display:block; width:${options.forPdf ? '38mm' : '160px'}; height:auto; margin:0 0 8px; }
.bs-kicker{ font-size:0.75em; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:${STAFF.textMuted}; }
.bs-title{ font-size:1.75em; font-weight:700; line-height:1.15; margin:2px 0 10px; overflow-wrap:anywhere; }
.bs-facts{ display:grid; grid-template-columns:repeat(auto-fit,minmax(${options.forPdf ? '42mm' : '200px'},1fr)); gap:0; border:1px solid ${STAFF.borderStrong}; }
.bs-fact{ padding:8px 10px; border-right:1px solid ${STAFF.border}; border-bottom:1px solid ${STAFF.border}; min-width:0; }
.bs-fact dt{ font-size:0.75em; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:${STAFF.textMuted}; }
.bs-fact dd{ font-weight:600; overflow-wrap:anywhere; }
.bs-section{ margin-top:${options.forPdf ? '5mm' : '20px'}; break-inside:auto; }
.bs-h2{ font-size:1.15em; font-weight:700; margin:0 0 6px; }
.bs-h3{ font-size:1em; font-weight:700; margin:0 0 4px; }
.bs-allergy{ border:3px solid ${STAFF.danger}; background:${STAFF.dangerSoft}; color:${STAFF.dangerFg}; padding:10px 12px; break-inside:avoid; }
.bs-allergy .bs-h2{ color:${STAFF.dangerFg}; }
.bs-allergy-line{ font-weight:600; margin:2px 0; overflow-wrap:anywhere; }
.bs-allergy-guest{ font-weight:700; }
.bs-allergy-none{ font-weight:600; }
.bs-key{ font-weight:700; }
.bs-tiers{ display:flex; flex-wrap:wrap; gap:6px 16px; margin-bottom:8px; }
.bs-tally-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(${options.forPdf ? '52mm' : '220px'},1fr)); gap:10px; }
.bs-course{ border:1px solid ${STAFF.borderStrong}; padding:8px 10px; break-inside:avoid; }
.bs-dish{ display:flex; gap:8px; margin:2px 0; overflow-wrap:anywhere; }
.bs-count{ display:inline-block; min-width:2.2em; font-weight:700; }
.bs-missing{ font-weight:700; font-style:italic; }
.bs-subhead{ font-size:0.8em; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:${STAFF.textMuted}; margin:6px 0 2px; }
.bs-table-wrap{ overflow-x:auto; border:1px solid ${STAFF.borderStrong}; }
.bs-table{ width:100%; min-width:${options.forPdf ? '0' : '880px'}; border-collapse:collapse; font-size:${options.forPdf ? '0.92em' : '0.95em'}; }
.bs-table caption{ text-align:left; font-weight:600; padding:6px 8px; color:${STAFF.textMuted}; }
.bs-table th,.bs-table td{ text-align:left; vertical-align:top; padding:6px 8px; border-top:1px solid ${STAFF.border}; overflow-wrap:break-word; }
.bs-table thead th{ background:${STAFF.surface2}; font-size:0.85em; letter-spacing:.04em; text-transform:uppercase; border-top:0; white-space:nowrap; }
.bs-table tbody tr{ break-inside:avoid; page-break-inside:avoid; }
.bs-table td.bs-cell-missing{ font-weight:700; font-style:italic; }
.bs-table td.bs-cell-not-included{ color:${STAFF.textMuted}; }
.bs-table td.bs-cell-off-menu{ font-weight:700; }
.bs-table td.bs-cell-allergy{ font-weight:700; color:${STAFF.dangerFg}; }
.bs-table td.bs-cell-unanswered{ font-weight:700; font-style:italic; }
.bs-late{ display:block; font-size:0.85em; font-weight:700; }
.bs-foot{ margin-top:${options.forPdf ? '5mm' : '20px'}; font-size:0.8em; color:${STAFF.textMuted}; }
.bs-print-refusal{ display:none; }`

  // D14: the shared front-of-house login views on screen only. The print stylesheet hides the
  // sheet and says why, so a browser print gives them no paper copy to leave on the pass.
  const noPrint = options.allowPrint
    ? ''
    : `
@media print{ .bs-sheet{ display:none !important; } .bs-print-refusal{ display:block !important; } }`

  // Printing the on-screen sheet from a laptop (owner request, 7 November 2026): the app shell
  // already drops out of print, and this drops the page header and its buttons too, so the paper
  // copy is the sheet alone. The PDF is rendered on its own, so it needs none of this.
  const sheetOnly =
    options.allowPrint && !options.forPdf
      ? `
@media print{ body *{ visibility:hidden; } .bs-sheet, .bs-sheet *{ visibility:visible; } }`
      : ''

  return `${base}${noPrint}${sheetOnly}`
}

function fact(label: string, value: string): string {
  return `<div class="bs-fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
}

function renderHeader(model: BookingSheetModel, options: BookingOnePagerOptions): string {
  const h = model.header
  const logo = options.logoDataUrl
    ? `<img class="bs-logo" src="${escapeHtml(options.logoDataUrl)}" alt="The Anchor">`
    : ''
  return `
  <header class="bs-head">
    ${logo}
    <p class="bs-kicker">Booking one-pager</p>
    <h1 class="bs-title">${escapeHtml(h.organiserName)}</h1>
    <dl class="bs-facts">
      ${fact('Day and date', h.dayDate)}
      ${fact('Time', h.time)}
      ${fact('Reference', h.reference)}
      ${fact('Organiser mobile', h.organiserMobile)}
      ${fact('Tables', h.tables)}
      ${fact('Guests', h.guests)}
      ${fact('Deposit', h.deposit)}
      ${fact('Choices', h.choices)}
      ${fact('Status', h.status)}${h.notes ? `
      ${fact('Booking notes', h.notes)}` : ''}
    </dl>
  </header>`
}

function renderAllergyBox(model: BookingSheetModel): string {
  const a = model.allergy
  const lines: string[] = []
  if (a.bookingAllergies.length) {
    lines.push(`<p class="bs-allergy-line"><span class="bs-key">Booking:</span> ${a.bookingAllergies.map(escapeHtml).join(', ')}</p>`)
  }
  if (a.bookingNotes) {
    lines.push(`<p class="bs-allergy-line"><span class="bs-key">Booking notes:</span> ${escapeHtml(a.bookingNotes)}</p>`)
  }
  for (const seat of a.seatAllergies) {
    lines.push(`<p class="bs-allergy-line bs-allergy-guest">${escapeHtml(seat)}</p>`)
  }
  if (a.noneRecorded) {
    lines.push('<p class="bs-allergy-line bs-allergy-none">No allergies recorded</p>')
  }
  if (a.bookingDietary.length) {
    lines.push(`<p class="bs-allergy-line"><span class="bs-key">Dietary:</span> ${a.bookingDietary.map(escapeHtml).join(', ')}</p>`)
  }
  if (a.seatsNotAnswered.length) {
    const seats = a.seatsNotAnswered.join(', ')
    lines.push(
      `<p class="bs-allergy-line"><span class="bs-key">Not answered:</span> seat${a.seatsNotAnswered.length === 1 ? '' : 's'} ${escapeHtml(seats)}. Ask before serving.</p>`
    )
  }

  return `
  <section class="bs-section bs-allergy" aria-labelledby="bs-allergy-title">
    <h2 class="bs-h2" id="bs-allergy-title">Allergies</h2>
    ${lines.join('\n    ')}
  </section>`
}

function dishLines(dishes: BookingSheetDishCount[]): string {
  return dishes
    .map((dish) => `<li class="bs-dish"><span class="bs-count">${dish.count} x</span><span>${escapeHtml(dish.name)}</span></li>`)
    .join('')
}

function renderCourse(course: BookingSheetCourseTally, tally: BookingSheetTally): string {
  const parts: string[] = []
  parts.push(course.dishes.length ? `<ul>${dishLines(course.dishes)}</ul>` : '<p>None chosen</p>')
  if (course.course === 'main' && tally.kidsMains.length) {
    parts.push(`<p class="bs-subhead">Kids mains</p><ul>${dishLines(tally.kidsMains)}</ul>`)
  }
  if (course.offMenu.length) {
    parts.push(`<p class="bs-subhead">Off the menu, ring the guest</p><ul>${dishLines(course.offMenu)}</ul>`)
  }
  parts.push(`<p class="bs-missing">Not chosen: ${course.notChosen}</p>`)
  if (course.course === 'dessert' && tally.starterOrDessertNotChosen > 0) {
    parts.push(`<p class="bs-missing">Starter or dessert not chosen (2 courses): ${tally.starterOrDessertNotChosen}</p>`)
  }
  return `
      <div class="bs-course">
        <h3 class="bs-h3">${escapeHtml(course.label)}s</h3>
        ${parts.join('\n        ')}
      </div>`
}

function renderTally(tally: BookingSheetTally): string {
  const tiers = tally.tiers
    ? `
    <p class="bs-tiers">
      <span><span class="bs-key">3 courses:</span> ${tally.tiers.three}</span>
      <span><span class="bs-key">2 courses:</span> ${tally.tiers.two}</span>
      <span><span class="bs-key">1 course:</span> ${tally.tiers.one}</span>
      <span class="bs-missing">Courses not chosen yet: ${tally.tiers.notChosen}</span>
    </p>`
    : ''
  const extras = `
      <div class="bs-course">
        <h3 class="bs-h3">Extras</h3>
        ${tally.extras.length ? `<ul>${dishLines(tally.extras)}</ul>` : '<p>None</p>'}
      </div>`
  return `
  <section class="bs-section" aria-labelledby="bs-tally-title">
    <h2 class="bs-h2" id="bs-tally-title">Kitchen tally</h2>${tiers}
    <div class="bs-tally-grid">${tally.courses.map((course) => renderCourse(course, tally)).join('')}${extras}
    </div>
  </section>`
}

function courseCell(cell: BookingSheetCell): string {
  const cls =
    cell.state === 'missing'
      ? ' class="bs-cell-missing"'
      : cell.state === 'not_included'
        ? ' class="bs-cell-not-included"'
        : cell.state === 'off_menu'
          ? ' class="bs-cell-off-menu"'
          : ''
  return `<td${cls}>${escapeHtml(cell.text)}</td>`
}

function renderSeatRow(seat: BookingSheetSeatRow): string {
  const allergyClass =
    seat.allergy.state === 'yes' ? ' class="bs-cell-allergy"' : seat.allergy.state === 'not_answered' ? ' class="bs-cell-unanswered"' : ''
  return `
        <tr>
          <th scope="row">${seat.seat}</th>
          <td>${escapeHtml(seat.name)}${seat.lateChange ? '<span class="bs-late">Changed after the cutoff</span>' : ''}</td>
          <td>${escapeHtml(seat.courses)}</td>
          ${courseCell(seat.starter)}
          ${courseCell(seat.main)}
          ${courseCell(seat.dessert)}
          <td>${escapeHtml(seat.extras)}</td>
          <td${allergyClass}>${escapeHtml(seat.allergy.text)}</td>
          <td>${escapeHtml(seat.dietary)}</td>
        </tr>`
}

function renderGuestTable(seats: BookingSheetSeatRow[]): string {
  return `
  <section class="bs-section" aria-labelledby="bs-guests-title">
    <h2 class="bs-h2" id="bs-guests-title">Guests</h2>
    <div class="bs-table-wrap">
      <table class="bs-table">
        <caption>One row per seat</caption>
        <thead>
          <tr>
            <th scope="col">Seat</th>
            <th scope="col">Name</th>
            <th scope="col">Courses</th>
            <th scope="col">Starter</th>
            <th scope="col">Main</th>
            <th scope="col">Dessert</th>
            <th scope="col">Extras</th>
            <th scope="col">Allergies</th>
            <th scope="col">Dietary needs</th>
          </tr>
        </thead>
        <tbody>${seats.map(renderSeatRow).join('')}
        </tbody>
      </table>
    </div>
  </section>`
}

/** The sheet itself, with its scoped styles. Safe to inject: every value is escaped. */
export function renderBookingOnePager(model: BookingSheetModel, options: BookingOnePagerOptions): string {
  const food = model.preorder
    ? `${renderTally(model.preorder.tally)}${renderGuestTable(model.preorder.seats)}`
    : `
  <section class="bs-section" aria-labelledby="bs-food-title">
    <h2 class="bs-h2" id="bs-food-title">Food</h2>
    <p>No food pre-order for this booking. Guests order from the menu on the day.</p>
  </section>`

  const foot = options.generatedAt
    ? `Generated at ${escapeHtml(options.generatedAt)}. The live system is the source of truth. Confidential, shred after service.`
    : 'The live system is the source of truth. Allergy details are confidential.'

  return `<style>${bookingOnePagerStyles(options)}
</style>
<div class="bs-sheet">${renderHeader(model, options)}${renderAllergyBox(model)}${food}
  <p class="bs-foot">${foot}</p>
</div>${options.allowPrint ? '' : `
<p class="bs-print-refusal">This sheet is for viewing on screen only. Ask a manager if you need a printed copy.</p>`}`
}

/** The same sheet as a whole A4 document, for the PDF route. */
export function generateBookingOnePagerHTML(model: BookingSheetModel, options: Omit<BookingOnePagerOptions, 'allowPrint' | 'forPdf'>): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>The Anchor booking one-pager</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{ size:A4 portrait; }
html,body{ margin:0; padding:0; background:${STAFF.surface}; font-family:'Outfit', system-ui, -apple-system, sans-serif; }
</style>
</head>
<body>
${renderBookingOnePager(model, { ...options, allowPrint: true, forPdf: true })}
</body>
</html>`
}
