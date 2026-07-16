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
  /** Pre-formatted London timestamp, e.g. "16 July 2026 at 7:32pm". */
  generatedAt: string
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
  .state-label{ font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0; flex-shrink:0; }
  .status{ font-family:var(--font-body); font-weight:600; font-size:16px; letter-spacing:.02em; color:var(--ink); margin:0; overflow-wrap:anywhere; word-break:break-word; }
  .foot{ margin-top:auto; padding-top:4mm; border-top:1.4px solid var(--ink); }
  .foot-line{ text-align:center; font-size:11px; line-height:1.5; color:var(--ink-soft); margin:0; }
  .foot-tag{ text-align:center; font-family:var(--font-script); font-size:19px; color:var(--ink-soft); margin:0; padding-top:1mm; }
  @page{ size:A4 portrait; margin:0; }`
}

function renderTableBookingSheetPage(
  data: TableBookingSheetData,
  options: TemplateOptions
): string {
  return `
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

      <div class="foot">
        <p class="foot-line">Generated at ${escapeHtml(data.generatedAt)}</p>
        <p class="foot-line">Live system is the source of truth</p>
        <p class="foot-tag">Where Everyone's Welcome</p>
      </div>
    </div>
  </section>`
}

export function generateTableBookingSheetsHTML(
  sheets: TableBookingSheetData[],
  options: TemplateOptions
): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>The Anchor Table Booking Sheets</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600;700;800&family=Clicker+Script&display=swap" rel="stylesheet">
<style>
${tableBookingSheetStyles()}
</style>
</head>
<body>
${sheets.map((sheet) => renderTableBookingSheetPage(sheet, options)).join('\n')}
</body>
</html>`
}
