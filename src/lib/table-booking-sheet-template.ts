/** One seat's food, as the kitchen reads it. All values are pre-formatted by the caller. */
export interface TableBookingSheetPreorderCover {
  /** "Seat 1", or "Seat 1 · Jo Bloggs" when a name was given. Never blank. */
  seatLabel: string
  /** Starter, main, dessert, in that order. Empty when this seat has chosen nothing yet. */
  courses: Array<{ courseLabel: string; itemName: string }>
  /** What the guest typed about their own requirements. Staff and kitchen only, never emailed. */
  dietaryNote: string | null
}

/**
 * The seasonal pre-order block. Its own page after the booking page, and absent on every ordinary
 * booking, which is what keeps those sheets byte-identical to what the pub prints today.
 */
export interface TableBookingSheetPreorder {
  /**
   * Booking-level allergies from `table_bookings.allergies`, which the pub already records. Carried
   * here so the food page can never show only the per-cover notes and silently drop an allergy.
   */
  allergies: string[]
  covers: TableBookingSheetPreorderCover[]
}

export interface TableBookingSheetData {
  bookingRef: string
  customerName: string
  /** Pre-formatted London date, e.g. "Thursday, 16 July 2026". */
  bookingDate: string
  /** Pre-formatted London time, e.g. "7:30pm". */
  startTime: string
  /** Pre-formatted party size, e.g. "6". */
  partySize: string
  /** "Window, 6" | "Outside" | "Unassigned" — never blank. */
  tableLabel: string
  /** "Booked" | "Seated" | "Pending payment" | … — never the raw DB status. */
  status: string
  /**
   * Seating needs the guest asked for, e.g. ["Step-free table", "High chair x2"].
   * Rendered as its own block only when non-empty.
   */
  requirements: string[]
  /** Pre-formatted London timestamp, e.g. "16 July 2026 at 7:32pm". */
  generatedAt: string
  /** Seasonal pre-order, when the booking has one. Omitted everywhere else. */
  preorder?: TableBookingSheetPreorder
}

interface TemplateOptions {
  logoDataUrl: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function tableBookingSheetStyles(): string {
  return `
  :root{
    --paper:#ffffff;
    --ink:#161616;
    --ink-soft:#363636;
    --ink-mute:#6b6b6b;
    --rule:#cfcfcf;
    --pad:13mm;
    --font-display:'DM Serif Display', Georgia, serif;
    --font-body:'Outfit', system-ui, -apple-system, sans-serif;
    --font-script:'Clicker Script', cursive;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    background:#fff;
    font-family:var(--font-body);
    color:var(--ink);
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .page{
    width:210mm;
    height:297mm;
    background:var(--paper);
    padding:var(--pad);
    position:relative;
    display:flex;
    flex-direction:column;
    overflow:hidden;
    page-break-after:always;
    break-after:page;
  }
  .page:last-child{ page-break-after:auto; break-after:auto; }
  .page::after{
    content:"";
    position:absolute;
    inset:7mm;
    border:1px solid var(--ink);
    pointer-events:none;
    z-index:1;
  }
  .page-inner{ position:relative; z-index:2; display:flex; flex-direction:column; height:100%; }
  .mast{ text-align:center; padding-bottom:3.6mm; margin-bottom:6mm; border-bottom:1.4px solid var(--ink); }
  .mast-logo{ display:block; height:auto; width:46mm; margin:0 auto 2.8mm; }
  .mast-kicker{ font-weight:600; font-size:9px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 1.6mm; }
  .mast-title{ font-family:var(--font-display); font-weight:400; font-size:38px; line-height:1.04; color:var(--ink); letter-spacing:-.02em; margin:0; overflow-wrap:anywhere; word-break:break-word; }
  .mast-note{ font-size:10px; letter-spacing:.04em; color:var(--ink-mute); margin:2.6mm 0 0; }
  .booking-ref{ color:var(--ink); font-weight:600; letter-spacing:.06em; overflow-wrap:anywhere; word-break:break-word; }
  .reserved{ margin-bottom:6mm; }
  .res-label{ font-weight:600; font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 1.8mm; }
  .customer-name{ font-family:var(--font-display); font-weight:400; font-size:34px; line-height:1.06; color:var(--ink); letter-spacing:-.01em; margin:0; overflow-wrap:anywhere; word-break:break-word; }
  .facts{ display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--ink); margin-bottom:6mm; }
  .fact{ padding:4.8mm 5mm; border-right:1px solid var(--rule); min-width:0; }
  .fact:last-child{ border-right:0; }
  .fact-label{ font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 2.6mm; }
  .fact-value{ font-family:var(--font-display); font-weight:400; font-size:26px; line-height:1.1; color:var(--ink); margin:0; overflow-wrap:anywhere; word-break:break-word; }
  .fact-value .unit{ font-family:var(--font-body); font-weight:500; font-size:12px; color:var(--ink-mute); margin-left:1.5mm; }
  .table-value{ font-size:22px; overflow-wrap:anywhere; word-break:break-word; }
  .state{ display:flex; align-items:baseline; gap:5mm; border:1px solid var(--ink); padding:4.8mm 5mm; margin-bottom:6mm; }
  .needs{ display:flex; align-items:baseline; gap:5mm; border:1px solid var(--ink); padding:4.8mm 5mm; margin-bottom:6mm; }
  .needs-label{ font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0; flex-shrink:0; }
  .needs-value{ font-family:var(--font-body); font-weight:600; font-size:16px; letter-spacing:.02em; color:var(--ink); margin:0; overflow-wrap:anywhere; word-break:break-word; }
  .state-label{ font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0; flex-shrink:0; }
  .status{ font-family:var(--font-body); font-weight:600; font-size:16px; letter-spacing:.02em; color:var(--ink); margin:0; overflow-wrap:anywhere; word-break:break-word; }
  .foot{ margin-top:auto; padding-top:4mm; border-top:1.4px solid var(--ink); }
  .foot-line{ text-align:center; font-size:11px; line-height:1.5; color:var(--ink-soft); margin:0; }
  .foot-tag{ text-align:center; font-family:var(--font-script); font-size:19px; color:var(--ink-soft); margin:0; padding-top:1mm; }
  @page{ size:A4 portrait; margin:0; }`
}

/**
 * Styles for the food page only, appended to the stylesheet solely when at least one sheet carries a
 * pre-order. A run of ordinary bookings therefore produces the same bytes it did before pre-orders
 * existed, which is what the baseline fixture test pins.
 *
 * The food page is deliberately `min-height` with no `overflow:hidden`, unlike `.page`. A booking
 * sheet is a fixed set of facts and always fits; a food list is as long as the party, and a kitchen
 * list that silently loses its last two seats is the worst failure this feature could have.
 */
function preorderPageStyles(): string {
  return `
  .food-page{
    width:210mm;
    min-height:297mm;
    background:var(--paper);
    padding:var(--pad);
    display:flex;
    flex-direction:column;
    page-break-after:always;
    break-after:page;
  }
  .food-page:last-child{ page-break-after:auto; break-after:auto; }
  .alerts{ border:1px solid var(--ink); padding:4.8mm 5mm; margin-bottom:6mm; }
  .alerts-label{ font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 2.2mm; }
  .alerts-value{ font-family:var(--font-body); font-weight:600; font-size:15px; line-height:1.4; color:var(--ink); margin:0; overflow-wrap:anywhere; word-break:break-word; }
  .alerts-none{ font-weight:400; color:var(--ink-mute); }
  .seats{ border:1px solid var(--ink); }
  .seat{ padding:4.2mm 5mm; border-bottom:1px solid var(--rule); break-inside:avoid; page-break-inside:avoid; }
  .seat:last-child{ border-bottom:0; }
  .seat-head{ font-weight:600; font-size:14px; letter-spacing:.02em; color:var(--ink); margin:0 0 2.4mm; overflow-wrap:anywhere; word-break:break-word; }
  .seat-course{ font-size:13px; line-height:1.45; color:var(--ink); margin:0 0 1.4mm; overflow-wrap:anywhere; word-break:break-word; }
  .seat-course:last-child{ margin-bottom:0; }
  .seat-course-label{ display:inline-block; width:20mm; font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); }
  .seat-empty{ font-size:13px; color:var(--ink-mute); margin:0; }
  .seat-note{ margin:2.6mm 0 0; padding-top:2.4mm; border-top:1px solid var(--rule); }
  .seat-note-label{ display:block; font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 1.4mm; }
  .seat-note-value{ font-size:13px; line-height:1.45; color:var(--ink); margin:0; overflow-wrap:anywhere; word-break:break-word; }`
}

function renderPreorderCover(cover: TableBookingSheetPreorderCover): string {
  const courses = cover.courses.length
    ? cover.courses
        .map(
          (course) =>
            `<p class="seat-course"><span class="seat-course-label">${escapeHtml(course.courseLabel)}</span>${escapeHtml(course.itemName)}</p>`
        )
        .join('\n          ')
    : '<p class="seat-empty">Nothing chosen yet</p>'

  const note = cover.dietaryNote
    ? `
          <div class="seat-note">
            <span class="seat-note-label">Dietary requirement, this guest</span>
            <p class="seat-note-value">${escapeHtml(cover.dietaryNote)}</p>
          </div>`
    : ''

  return `
        <div class="seat">
          <p class="seat-head">${escapeHtml(cover.seatLabel)}</p>
          ${courses}${note}
        </div>`
}

/**
 * The kitchen's food page. Both allergy sources appear, each labelled: the booking-level list the pub
 * already records, and the per-seat note the guest typed. Showing one without the other would read as
 * a complete picture while being an incomplete one.
 */
function renderPreorderPage(
  data: TableBookingSheetData,
  preorder: TableBookingSheetPreorder,
  options: TemplateOptions
): string {
  const allergies = preorder.allergies.length
    ? `<p class="alerts-value">${preorder.allergies.map((item) => escapeHtml(item)).join(' · ')}</p>`
    : '<p class="alerts-value alerts-none">None recorded</p>'

  return `
  <section class="food-page">
    <div class="page-inner">
      <div class="mast">
        <img class="mast-logo" src="${escapeHtml(options.logoDataUrl)}" alt="The Anchor">
        <p class="mast-kicker">Kitchen pre-order</p>
        <h1 class="mast-title">${escapeHtml(data.customerName)}</h1>
        <p class="mast-note">Reference <span class="booking-ref">${escapeHtml(data.bookingRef)}</span> · ${escapeHtml(data.bookingDate)} · ${escapeHtml(data.startTime)} · ${escapeHtml(data.partySize)} guests</p>
      </div>

      <div class="alerts">
        <p class="alerts-label">Allergies, whole booking</p>
        ${allergies}
      </div>

      <div class="seats">${preorder.covers.map((cover) => renderPreorderCover(cover)).join('')}
      </div>

      <div class="foot">
        <p class="foot-line">Generated at ${escapeHtml(data.generatedAt)}</p>
        <p class="foot-line">Live system is the source of truth</p>
        <p class="foot-tag">Where Everyone's Welcome</p>
      </div>
    </div>
  </section>`
}

function renderTableBookingSheetPage(
  data: TableBookingSheetData,
  options: TemplateOptions
): string {
  const bookingPage = `
  <section class="page">
    <div class="page-inner">
      <div class="mast">
        <img class="mast-logo" src="${escapeHtml(options.logoDataUrl)}" alt="The Anchor">
        <p class="mast-kicker">Table booking</p>
        <h1 class="mast-title">${escapeHtml(data.bookingDate)}</h1>
        <p class="mast-note">Reference <span class="booking-ref">${escapeHtml(data.bookingRef)}</span></p>
      </div>

      <div class="reserved">
        <p class="res-label">Reserved for</p>
        <p class="customer-name">${escapeHtml(data.customerName)}</p>
      </div>

      <div class="facts">
        <div class="fact">
          <p class="fact-label">Time</p>
          <p class="fact-value">${escapeHtml(data.startTime)}</p>
        </div>
        <div class="fact">
          <p class="fact-label">Party size</p>
          <p class="fact-value"><span>${escapeHtml(data.partySize)}</span><span class="unit">guests</span></p>
        </div>
        <div class="fact">
          <p class="fact-label">Table</p>
          <p class="fact-value table-value">${escapeHtml(data.tableLabel)}</p>
        </div>
      </div>

      <div class="state">
        <p class="state-label">Status</p>
        <p class="status">${escapeHtml(data.status)}</p>
      </div>
${data.requirements.length ? `
      <div class="needs">
        <p class="needs-label">Seating needs</p>
        <p class="needs-value">${data.requirements.map((item) => escapeHtml(item)).join(' · ')}</p>
      </div>` : ''}

      <div class="foot">
        <p class="foot-line">Generated at ${escapeHtml(data.generatedAt)}</p>
        <p class="foot-line">Live system is the source of truth</p>
        <p class="foot-tag">Where Everyone's Welcome</p>
      </div>
    </div>
  </section>`

  // Concatenated rather than woven in, so a booking with no pre-order returns exactly the string it
  // returned before this feature existed.
  return data.preorder
    ? `${bookingPage}${renderPreorderPage(data, data.preorder, options)}`
    : bookingPage
}

export function generateTableBookingSheetsHTML(
  sheets: TableBookingSheetData[],
  options: TemplateOptions
): string {
  const hasPreorder = sheets.some((sheet) => sheet.preorder)

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>The Anchor Table Booking Sheets</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600;700;800&family=Clicker+Script&display=swap" rel="stylesheet">
<style>
${tableBookingSheetStyles()}${hasPreorder ? preorderPageStyles() : ''}
</style>
</head>
<body>
${sheets.map((sheet) => renderTableBookingSheetPage(sheet, options)).join('\n')}
</body>
</html>`
}
