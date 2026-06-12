export interface EventBookingSheetData {
  bookingRef: string
  eventName: string
  eventDate: string
  startTime: string
  host: string
  customerName: string
  seats: string
  seatingType: string
  tableNumber: string | null
  price: string
  priceNote: string
  paymentMethod: string
  bookingNotes: string | null
}

interface TemplateOptions {
  logoDataUrl: string
  sundayRoastQrDataUrl: string
  sundayRoastItems: EventBookingSheetMenuItem[]
}

export interface EventBookingSheetMenuItem {
  name: string
  price: string
  badge?: string | null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function bookingSheetStyles(): string {
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
  .mast{ text-align:center; padding-bottom:3.6mm; margin-bottom:5mm; border-bottom:1.4px solid var(--ink); }
  .mast-logo{ display:block; height:auto; width:46mm; margin:0 auto 2.8mm; }
  .mast-title{ font-family:var(--font-display); font-weight:400; font-size:42px; line-height:1; color:var(--ink); letter-spacing:-.02em; margin:0; }
  .mast-script{ font-family:var(--font-script); font-size:22px; color:var(--ink-soft); line-height:1; margin:1.6mm 0 0; }
  .mast-note{ font-size:10px; letter-spacing:.04em; color:var(--ink-mute); margin:2.4mm 0 0; }
  .mast-note b{ color:var(--ink); font-weight:600; letter-spacing:.06em; }
  .feature{ border:1px solid var(--ink); padding:5mm 6mm; margin-bottom:5mm; }
  .feature-kicker{ font-weight:600; font-size:9px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-mute); margin:0; }
  .feature-title{ font-family:var(--font-display); font-weight:400; font-size:30px; line-height:1.02; color:var(--ink); margin:1.6mm 0 2mm; letter-spacing:-.015em; }
  .feature-sub{ font-size:12.5px; color:var(--ink-soft); line-height:1.5; margin:0; }
  .feature-sub b{ color:var(--ink); font-weight:600; }
  .feature-sub .dot{ color:var(--rule); margin:0 2mm; }
  .reserved{ margin-bottom:5mm; }
  .res-label{ font-weight:600; font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 1.6mm; }
  .res-name{ font-family:var(--font-display); font-weight:400; font-size:30px; line-height:1; color:var(--ink); letter-spacing:-.01em; margin:0; }
  .facts{ display:grid; border:1px solid var(--ink); margin-bottom:5mm; }
  .facts--with-table{ grid-template-columns:repeat(3,1fr); }
  .facts--without-table{ grid-template-columns:repeat(2,1fr); }
  .fact{ padding:4.4mm 5mm; border-right:1px solid var(--rule); }
  .fact:last-child{ border-right:0; }
  .fact-label{ font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 2.4mm; }
  .fact-value{ font-family:var(--font-display); font-weight:400; font-size:26px; line-height:1; color:var(--ink); margin:0; }
  .fact-value .unit{ font-family:var(--font-body); font-weight:500; font-size:12px; color:var(--ink-mute); margin-left:1.5mm; }
  .pay{ display:flex; border:1px solid var(--ink); margin-bottom:5mm; }
  .pay-cell{ flex:1; padding:4.4mm 5mm; }
  .pay-cell--right{ border-left:1px solid var(--rule); text-align:right; display:flex; flex-direction:column; justify-content:center; }
  .pay-label{ font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 2.4mm; }
  .pay-value{ font-family:var(--font-display); font-weight:400; font-size:26px; line-height:1; color:var(--ink); margin:0 0 1.4mm; }
  .pay-note{ font-size:10px; color:var(--ink-mute); margin:0; }
  .pay-method{ font-family:var(--font-body); font-weight:600; font-size:16px; color:var(--ink); margin:0; }
  .notes{ border:1px solid var(--rule); padding:3.6mm 4.6mm; }
  .notes-label{ font-weight:600; font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 1.6mm; }
  .notes-text{ font-size:11.5px; line-height:1.5; color:var(--ink-soft); margin:0; }
  .promo{ display:flex; align-items:center; gap:6mm; border:1px solid var(--ink); padding:4.8mm 5.5mm; margin-top:auto; }
  .promo-text{ flex:1; min-width:0; }
  .promo-kicker{ font-weight:600; font-size:9px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 1.6mm; }
  .promo-title{ font-family:var(--font-display); font-weight:400; font-size:23px; line-height:1.02; color:var(--ink); margin:0 0 2mm; letter-spacing:-.01em; }
  .promo-copy{ font-size:11px; line-height:1.5; color:var(--ink-soft); margin:0; }
  .promo-copy b{ color:var(--ink); font-weight:600; }
  .promo-qr{ flex-shrink:0; text-align:center; }
  .promo-qr img{ width:25mm; height:25mm; display:block; filter:grayscale(1) contrast(1.08); }
  .promo-qr-cap{ font-size:8.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-mute); margin:1.4mm 0 0; line-height:1.4; }
  .promo-list{ display:grid; grid-template-columns:repeat(2,1fr); column-gap:6mm; row-gap:1.6mm; margin-top:3.4mm; }
  .promo-item{ font-size:11px; line-height:1.25; color:var(--ink); }
  .promo-item .nm{ font-weight:500; }
  .promo-item .pr{ font-weight:600; margin-left:5px; }
  .promo-item .vg{ font-size:8px; font-weight:700; letter-spacing:.03em; border:1px solid var(--ink); border-radius:3px; padding:0 2.5px; margin-left:4px; vertical-align:1px; }
  .foot{ margin-top:auto; padding-top:4mm; border-top:1.4px solid var(--ink); }
  .foot-welcome{ max-width:120mm; margin:0 auto 2.4mm; text-align:center; font-size:11.5px; line-height:1.5; color:var(--ink-soft); }
  .foot-tag{ text-align:center; font-family:var(--font-script); font-size:19px; color:var(--ink-soft); margin:0; padding-top:1mm; }
  @page{ size:A4 portrait; margin:0; }`
}

function renderBookingSheetPage(
  data: EventBookingSheetData,
  options: TemplateOptions
): string {
  const hasTable = Boolean(data.tableNumber?.trim())
  const hasNotes = Boolean(data.bookingNotes?.trim())
  const menuItems = options.sundayRoastItems.length > 0
    ? options.sundayRoastItems
    : [{ name: 'Ask the team for this Sunday\'s roast menu', price: '', badge: null }]

  return `
  <section class="page">
    <div class="page-inner">
      <div class="mast">
        <img class="mast-logo" src="${options.logoDataUrl}" alt="The Anchor">
        <h1 class="mast-title">Reserved</h1>
        <p class="mast-script">We've saved your table</p>
        <p class="mast-note">Reference <b>${escapeHtml(data.bookingRef)}</b></p>
      </div>

      <div class="feature">
        <p class="feature-kicker">The event</p>
        <h2 class="feature-title">${escapeHtml(data.eventName)}</h2>
        <p class="feature-sub"><b>${escapeHtml(data.eventDate)}</b><span class="dot">&middot;</span>from <b>${escapeHtml(data.startTime)}</b><span class="dot">&middot;</span>hosted by <b>${escapeHtml(data.host)}</b></p>
      </div>

      <div class="reserved">
        <p class="res-label">Reserved for</p>
        <p class="res-name">${escapeHtml(data.customerName)}</p>
      </div>

      <div class="facts ${hasTable ? 'facts--with-table' : 'facts--without-table'}">
        <div class="fact">
          <p class="fact-label">Party size</p>
          <p class="fact-value"><span>${escapeHtml(data.seats)}</span><span class="unit">guests</span></p>
        </div>
        <div class="fact">
          <p class="fact-label">Seating</p>
          <p class="fact-value" style="font-size:22px;">${escapeHtml(data.seatingType)}</p>
        </div>
        ${hasTable ? `<div class="fact"><p class="fact-label">Table</p><p class="fact-value">${escapeHtml(data.tableNumber || '')}</p></div>` : ''}
      </div>

      <div class="pay">
        <div class="pay-cell">
          <p class="pay-label">Booking total</p>
          <p class="pay-value">${escapeHtml(data.price)}</p>
          <p class="pay-note">${escapeHtml(data.priceNote)}</p>
        </div>
        <div class="pay-cell pay-cell--right">
          <p class="pay-label">Payment</p>
          <p class="pay-method">${escapeHtml(data.paymentMethod)}</p>
        </div>
      </div>

      ${hasNotes ? `<div class="notes"><p class="notes-label">Booking notes</p><p class="notes-text">${escapeHtml(data.bookingNotes || '')}</p></div>` : ''}

      <div class="promo">
        <div class="promo-text">
          <p class="promo-kicker">Every Sunday &middot; 1pm to 6pm</p>
          <h3 class="promo-title">Why not book in for this Sunday?</h3>
          <p class="promo-copy">Carved fresh to order, piled high with all the trimmings. <b>Bookings aren't required, but they're recommended.</b></p>
          <div class="promo-list">
            ${menuItems.map((item) => (
              `<div class="promo-item"><span class="nm">${escapeHtml(item.name)}</span>${item.badge ? `<span class="vg">${escapeHtml(item.badge)}</span>` : ''}${item.price ? `<span class="pr">${escapeHtml(item.price)}</span>` : ''}</div>`
            )).join('\n')}
          </div>
        </div>
        <div class="promo-qr">
          <img src="${options.sundayRoastQrDataUrl}" alt="Scan to book a Sunday roast and see the details">
          <p class="promo-qr-cap">Scan to book &amp;<br>see the full menu</p>
        </div>
      </div>

      <div class="foot">
        <p class="foot-welcome">Welcome. Make yourself comfortable, and just ask any of the team if you need anything at all.</p>
        <p class="foot-tag">Where Everyone's Welcome</p>
      </div>
    </div>
  </section>`
}

export function generateEventBookingSheetHTML(
  data: EventBookingSheetData,
  options: TemplateOptions
): string {
  return generateEventBookingSheetsHTML([data], options)
}

export function generateEventBookingSheetsHTML(
  sheets: EventBookingSheetData[],
  options: TemplateOptions
): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>The Anchor Booking Sheets</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600;700;800&family=Clicker+Script&display=swap" rel="stylesheet">
<style>
${bookingSheetStyles()}
</style>
</head>
<body>
${sheets.map((sheet) => renderBookingSheetPage(sheet, options)).join('\n')}
</body>
</html>`
}
