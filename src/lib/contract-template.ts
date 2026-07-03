import { PrivateBookingWithDetails, PrivateBookingItem } from '@/types/private-bookings'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'

export interface ContractData {
  booking: PrivateBookingWithDetails
  logoUrl?: string
  companyDetails?: {
    name: string
    registrationNumber?: string
    vatNumber?: string
    address: string
    phone: string
    email: string
  }
}

// The "Bring Your Own Food" catering package (see
// supabase/migrations/20260405120000_standardise_catering_options.sql). When a booking
// includes this package, the optional self-catering food release & indemnity waiver
// annex is appended to the contract. Matched by fixed id first, with a name fallback so
// a re-seeded package (different id, same name) still triggers the annex.
const BYO_FOOD_PACKAGE_ID = '9fdbf82b-6717-4bff-8af6-8865cb5bfe21'

export function generateContractHTML(data: ContractData): string {
  const { booking, logoUrl } = data

  // ---- helpers ----
  const formatDate = (date: string | null) => formatDateFull(date)
  const formatTime = (time: string | null) => formatTime12Hour(time)
  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  // ---- financial calculations ----
  const calculateSubtotal = () =>
    booking.items?.reduce((sum: number, item: PrivateBookingItem) => {
      // line_total is a database-generated column
      const lineTotal = typeof item.line_total === 'string' ? parseFloat(item.line_total) : item.line_total
      return sum + (lineTotal || 0)
    }, 0) || 0

  // Original price before any item-level discounts
  const calculateOriginalTotal = () =>
    booking.items?.reduce((sum: number, item: PrivateBookingItem) => {
      const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : item.quantity
      const price = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : item.unit_price
      return sum + (qty * price)
    }, 0) || 0

  const calculateDiscountAmount = () => {
    const subtotal = calculateSubtotal()
    if (!booking.discount_amount || booking.discount_amount === 0) return 0
    return booking.discount_type === 'percent'
      ? subtotal * (booking.discount_amount / 100)
      : booking.discount_amount
  }

  const calculateTotal = () => calculateSubtotal() - calculateDiscountAmount()

  // ---- extract details ----
  const ref = `PB-${booking.id.slice(0, 8).toUpperCase()}`
  const customerName = booking.customer_full_name || booking.customer_name || 'To be confirmed'
  const isTbd = isBookingDateTbd(booking)
  const eventDate = isTbd ? 'Date to be confirmed' : formatDate(booking.event_date)
  const startTime = isTbd ? 'To be confirmed' : formatTime(booking.start_time)
  const rawEndTime = formatTime(booking.end_time || null)
  const endTime = booking.end_time && booking.end_time_next_day ? `${rawEndTime} (+1 day)` : rawEndTime
  const eventType = booking.event_type || 'To be confirmed'
  const guestCount = booking.guest_count || 'To be confirmed'
  const depositAmount = booking.deposit_amount ?? 250
  const subtotal = calculateSubtotal()
  const originalTotal = calculateOriginalTotal()
  const total = calculateTotal()

  // The deposit is separate from the event balance and cannot be used towards it.
  // Only event-balance payments (private_booking_payments) reduce the balance.
  const totalPaid = booking.final_payment_date
    ? total
    : ((booking.payments || []) as Array<{ amount: number | string }>).reduce((sum, p) => {
        const paid = typeof p.amount === 'string' ? parseFloat(p.amount) : (p.amount ?? 0)
        return sum + (Number.isFinite(paid) ? paid : 0)
      }, 0)
  const balanceDue = Math.max(0, total - totalPaid)

  // Balance-due date — prefer explicit field, else 14 days before the event
  let balanceDueDate = 'To be confirmed'
  if (isTbd) {
    balanceDueDate = 'To be confirmed (date TBD)'
  } else if (booking.balance_due_date) {
    balanceDueDate = formatDate(booking.balance_due_date)
  } else if (booking.event_date) {
    const eventDateObj = new Date(booking.event_date)
    const dueDate = new Date(eventDateObj.getTime() - 14 * 24 * 60 * 60 * 1000)
    balanceDueDate = formatDate(dueDate.toISOString())
  }

  // ---- pre-escaped / composed values ----
  const clean = (value?: string | null) => {
    const trimmed = (value || '').trim()
    return trimmed ? escapeHtml(trimmed) : null
  }
  const safeCustomerName = escapeHtml(customerName)
  const safeEventType = escapeHtml(eventType)
  const safePhone = booking.contact_phone ? escapeHtml(booking.contact_phone) : '&mdash;'
  const safeEmail = booking.contact_email ? escapeHtml(booking.contact_email) : '&mdash;'
  // Operational details carried over from the booking — rendered only when present so the
  // fixed-height page fill is unaffected for bookings that have none.
  const safeSpecialRequirements = clean(booking.special_requirements)
  const safeAccessibilityNeeds = clean(booking.accessibility_needs)
  const safeContractNote = clean(booking.contract_note)
  const generatedDate = formatDate(new Date().toISOString())
  const eventDateTime = isTbd
    ? 'Date to be confirmed'
    : `${eventDate}${startTime && startTime !== 'TBC' ? `, ${startTime}&ndash;${endTime}` : ''}`
  const depositStatus = booking.deposit_paid_date ? `paid ${formatDate(booking.deposit_paid_date)}` : 'due'
  const logo = logoUrl ? encodeURI(logoUrl) : '/logo-black.png'
  const venue = 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ'

  // ---- self-catering (bring your own food) detection ----
  const hasOwnFood = (booking.items || []).some((item: PrivateBookingItem) => {
    if (item.item_type !== 'catering') return false
    if (item.package?.id === BYO_FOOD_PACKAGE_ID) return true
    return (item.package?.name || '').toLowerCase().includes('bring your own')
  })

  const waiverEventDetails =
    typeof booking.guest_count === 'number' && booking.guest_count > 0
      ? `${safeEventType} &middot; approx. ${booking.guest_count} guests`
      : safeEventType

  // ---- shared shell fragments ----
  const runHead = (kind: string, refHtml: string) => `
        <header class="run-head">
          <img class="run-head-logo" src="${logo}" alt="The Anchor">
          <div class="run-head-meta">
            <span class="doc-kind">${kind}</span>
            <span class="doc-ref">${refHtml}</span>
          </div>
        </header>`

  const runFoot = (reg: string, pageLabel: string) => `
        <footer class="run-foot">
          <p class="foot-reg">${reg}</p>
          <div class="foot-right">
            <span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>
            <span class="foot-page">${pageLabel} <b class="pageno">1</b> of <b class="pagetot">1</b></span>
          </div>
        </footer>`

  const regFull = `<b>Orange Jelly Limited</b> trading as The Anchor &middot; The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47`
  const regShort = `<b>Orange Jelly Limited</b> trading as The Anchor &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47`
  const regWaiver = `<b>Orange Jelly Limited</b> trading as The Anchor &middot; Self-catering food waiver &middot; Registered in England &amp; Wales no. 10537179 &middot; VAT 315 2036 47`

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Anchor — Private Booking Contract — ${safeCustomerName}</title>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600;700;800&family=Clicker+Script&display=swap" rel="stylesheet">

<style>
  :root{
    --paper:#ffffff;
    --ink:#161616;
    --ink-soft:#363636;
    --ink-mute:#6b6b6b;
    --rule:#cfcfcf;
    --font-display:'DM Serif Display', Georgia, serif;
    --font-body:'Outfit', system-ui, -apple-system, sans-serif;
    --font-script:'Clicker Script', cursive;
  }

  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    background:#3a3a3a;
    font-family:var(--font-body);
    color:var(--ink);
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }

  /* ---------- screen scaffolding ---------- */
  .screen-note{ color:#e9e4d8; font-size:13.5px; text-align:center; padding:24px 16px 4px; line-height:1.6; }
  .screen-note strong{ color:#fff; font-weight:600; }
  .screen-note .sub{ display:block; color:#b3ada1; font-size:12px; margin-top:5px; }
  .toolbar{ display:flex; align-items:center; justify-content:center; gap:14px; padding:6px 0 2px; }
  .print-btn{ font-family:var(--font-body); font-weight:600; font-size:13px; color:#161616; background:#e9e4d8; border:0; border-radius:999px; padding:9px 22px; cursor:pointer; }
  .print-btn:hover{ background:#fff; }
  .back-link{ font-family:var(--font-body); font-weight:600; font-size:13px; color:#e9e4d8; text-decoration:none; border:1px solid #6f6a61; border-radius:999px; padding:8px 18px; }
  .back-link:hover{ color:#fff; border-color:#e9e4d8; }
  .stage{ display:flex; flex-direction:column; align-items:center; gap:10mm; padding:22px 0 70px; }

  .doc-divider{ width:210mm; max-width:92vw; color:#e9e4d8; text-align:center; font-size:12px; letter-spacing:.18em; text-transform:uppercase; display:flex; align-items:center; gap:14px; opacity:.75; }
  .doc-divider::before,.doc-divider::after{ content:""; flex:1; height:1px; background:#6f6a61; }

  /* ---------- A4 sheet ---------- */
  .sheet{ width:210mm; height:297mm; background:var(--paper); padding:11mm 12mm; position:relative; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 16px 46px rgba(0,0,0,.42); }
  .sheet::after{ content:""; position:absolute; inset:5.5mm; border:1px solid var(--ink); pointer-events:none; z-index:1; }
  .sheet-inner{ position:relative; z-index:2; display:flex; flex-direction:column; height:100%; }

  /* ---------- running header ---------- */
  .run-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:8mm; padding-bottom:2.4mm; border-bottom:1px solid var(--ink); }
  .run-head-logo{ height:8mm; width:auto; display:block; }
  .run-head-meta{ text-align:right; line-height:1.3; }
  .doc-kind{ display:block; font-family:var(--font-display); font-size:14px; color:var(--ink); line-height:1; letter-spacing:-.01em; }
  .doc-ref{ display:block; font-size:8px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-mute); margin-top:1.2mm; }
  .doc-ref b{ color:var(--ink-soft); font-weight:600; }

  /* ---------- body ---------- */
  .body{ flex:1 1 auto; padding-top:3.4mm; min-height:0; }

  /* ---------- cover ---------- */
  .cover-kicker{ font-weight:600; font-size:8.5px; letter-spacing:.22em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 2mm; }
  .cover-title{ font-family:var(--font-display); font-weight:400; font-size:34px; line-height:1.02; color:var(--ink); letter-spacing:-.02em; margin:0 0 2mm; }
  .cover-script{ font-family:var(--font-script); font-size:19px; color:var(--ink-soft); line-height:1; margin:0 0 4mm; }
  .meta{ display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--ink); margin:0 0 4mm; }
  .meta-cell{ padding:2.8mm 4mm; border-right:1px solid var(--rule); }
  .meta-cell:last-child{ border-right:0; }
  .meta-label{ font-weight:600; font-size:8px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-mute); margin:0 0 1.4mm; }
  .meta-value{ font-size:12.5px; font-weight:500; color:var(--ink); margin:0; line-height:1.25; }

  .section-label{ font-weight:700; font-size:9.5px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink); margin:0 0 2.4mm; padding-bottom:1.4mm; border-bottom:1px solid var(--rule); }
  .section-label.gap{ margin-top:4mm; }

  /* detail rows (customer / event) */
  .detail-grid{ display:grid; grid-template-columns:1fr 1fr; gap:1.6mm 8mm; margin:0 0 4mm; }
  .drow{ display:flex; gap:3mm; font-size:11.5px; line-height:1.4; align-items:baseline; }
  .drow .dk{ font-size:8px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-mute); font-weight:600; min-width:24mm; flex-shrink:0; }
  .drow .dv{ color:var(--ink); font-weight:500; }

  /* financial summary + deposit side by side */
  .money{ display:grid; grid-template-columns:1fr 1fr; gap:6mm; margin:0 0 4mm; align-items:start; }
  .fin{ border:1px solid var(--ink); }
  .fin-row{ display:flex; justify-content:space-between; align-items:baseline; padding:2.2mm 3.6mm; border-bottom:1px solid var(--rule); font-size:11px; color:var(--ink-soft); }
  .fin-row:last-child{ border-bottom:0; }
  .fin-row .fv{ font-weight:600; color:var(--ink); font-variant-numeric:tabular-nums; }
  .fin-row.total{ background:#f4f1ea; }
  .fin-row.total .fk{ font-weight:700; color:var(--ink); text-transform:uppercase; letter-spacing:.06em; font-size:9.5px; }
  .fin-row.total .fv{ font-size:13px; }
  .deposit-box{ border:1.4px solid var(--ink); padding:3mm 4mm; background:#f4f1ea; display:flex; flex-direction:column; justify-content:center; height:100%; }
  .deposit-box .db-l{ font-weight:700; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink); }
  .deposit-box .db-r{ font-family:var(--font-display); font-size:26px; color:var(--ink); line-height:1; margin:1.4mm 0; }
  .deposit-box small{ font-weight:500; font-size:9px; color:var(--ink-mute); line-height:1.35; }
  .callout{ font-size:10px; line-height:1.45; color:var(--ink-soft); border-left:2px solid var(--ink); padding:0.6mm 0 0.6mm 3.6mm; margin:0 0 4mm; }
  .callout b{ color:var(--ink); font-weight:700; }

  /* ---------- numbered clauses (waiver) ---------- */
  ol.contract{ list-style:none; margin:0; padding:0; counter-reset:l1; }
  ol.contract > li{ counter-increment:l1; margin:0 0 2.6mm; break-inside:avoid; }
  ol.contract > li:last-child{ margin-bottom:0; }
  .clause-h{ position:relative; padding-left:7mm; font-weight:700; font-size:11.5px; color:var(--ink); margin:0 0 1.2mm; line-height:1.2; }
  .clause-h::before{ content:counter(l1) "."; position:absolute; left:0; top:0; width:6mm; font-weight:700; }
  ol.sub{ list-style:none; margin:0; padding:0; counter-reset:l2; }
  ol.sub > li{ counter-increment:l2; position:relative; padding-left:9mm; font-size:9.6px; line-height:1.38; color:var(--ink-soft); margin:0 0 0.9mm; }
  ol.sub > li::before{ content:counter(l1) "." counter(l2); position:absolute; left:0; top:0; font-weight:600; color:var(--ink); font-size:9px; }
  ol.sub > li:last-child{ margin-bottom:0; }
  ol.sub b{ color:var(--ink); font-weight:600; }

  /* ---------- prose (deposit info, agreement) ---------- */
  .tc > p{ font-size:10.4px; line-height:1.44; color:var(--ink-soft); margin:0 0 1.5mm; }
  .tc > p:last-child{ margin-bottom:0; }
  .tc b{ color:var(--ink); font-weight:600; }

  /* ---------- two-column terms ---------- */
  .tc-cols{ columns:2; column-gap:7mm; }
  .tc-sec{ break-inside:avoid; margin:0 0 2.8mm; }
  .tc-h{ font-weight:700; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink); margin:0 0 1.3mm; padding-bottom:1mm; border-bottom:1px solid var(--rule); }
  .tc-sec p{ font-size:9.1px; line-height:1.38; color:var(--ink-soft); margin:0 0 1.1mm; }
  .tc-sec p:last-child{ margin-bottom:0; }
  .tc-sec b{ color:var(--ink); font-weight:600; }

  /* bullet points */
  ul.points{ list-style:none; margin:0; padding:0; columns:2; column-gap:7mm; }
  ul.points > li{ position:relative; padding-left:4.6mm; font-size:10px; line-height:1.34; color:var(--ink-soft); margin:0 0 1.2mm; break-inside:avoid; }
  ul.points > li::before{ content:""; position:absolute; left:0; top:1.8mm; width:2.2mm; border-top:1px solid var(--ink); }
  ul.points > li b{ color:var(--ink); font-weight:600; }

  .addr{ font-size:10.5px; line-height:1.5; color:var(--ink); font-weight:500; border-left:2px solid var(--ink); padding-left:4mm; margin:2mm 0 0; }

  /* ---------- signatures ---------- */
  .sign-intro{ font-size:10.4px; line-height:1.5; color:var(--ink-soft); margin:0 0 3.4mm; }
  .sign-intro b{ color:var(--ink); font-weight:600; }
  .sign-grid{ display:grid; grid-template-columns:1fr 1fr; gap:7mm; }
  .sign-card{ border:1px solid var(--ink); padding:4mm 4.4mm; }
  .sign-card-h{ font-weight:700; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink); margin:0 0 0.8mm; line-height:1.35; }
  .sign-card-sub{ font-size:10px; color:var(--ink-mute); line-height:1.4; margin:0 0 5mm; }
  .sf{ margin:0 0 4.6mm; }
  .sf:last-child{ margin-bottom:0; }
  .sf-rule{ border-bottom:1px solid var(--ink); height:7mm; position:relative; }
  .sf-rule.tall{ height:11mm; }
  .sf-v{ position:absolute; left:1mm; bottom:1.2mm; font-size:12px; color:var(--ink); font-weight:500; }
  .sf-cap{ font-size:8.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-mute); margin:1mm 0 0; display:block; }
  .sf-row{ display:grid; grid-template-columns:1fr 1fr; gap:4.4mm; }

  .fill{ color:var(--ink-mute); border-bottom:1px dotted var(--ink-mute); padding:0 2px; font-style:normal; }

  /* ---------- running footer ---------- */
  .run-foot{ margin-top:auto; padding-top:2.4mm; border-top:1px solid var(--ink); display:flex; align-items:center; justify-content:space-between; gap:6mm; }
  .foot-reg{ font-size:8px; line-height:1.4; color:var(--ink-mute); max-width:120mm; }
  .foot-reg b{ color:var(--ink-soft); font-weight:600; }
  .foot-right{ display:flex; align-items:center; gap:6mm; flex-shrink:0; }
  .foot-init{ font-size:8px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-mute); display:flex; align-items:center; gap:2.2mm; white-space:nowrap; }
  .init-box{ display:inline-block; width:11mm; height:5.4mm; border:1px solid var(--ink); vertical-align:middle; }
  .foot-page{ font-size:8.5px; letter-spacing:.06em; color:var(--ink-soft); white-space:nowrap; }
  .foot-page b{ color:var(--ink); font-weight:600; }

  @media print{
    @page{ size:A4 portrait; margin:0; }
    body{ background:#fff; }
    .screen-note,.toolbar,.doc-divider{ display:none !important; }
    .stage{ display:block; padding:0; gap:0; }
    .sheet{ box-shadow:none; break-after:page; }
    .sheet:last-child{ break-after:auto; }
  }
</style>
</head>
<body>

  <div class="screen-note">
    <strong>The Anchor — Private booking contract.</strong> ${safeCustomerName} &middot; ${safeEventType} &middot; ${eventDate} &middot; ref ${ref}.${hasOwnFood ? ' Followed by an <strong>optional self-catering food waiver</strong> (separate annex, separate signature).' : ''}
    <span class="sub">Each sheet is one printed page. Print &middot; A4 &middot; Portrait &middot; margins &ldquo;None&rdquo;.</span>
  </div>
  <div class="toolbar">
    <a class="back-link" href="/private-bookings/${booking.id}">&larr; Back to booking</a>
    <button class="print-btn" onclick="window.print()">Print / save as PDF</button>
  </div>

  <div class="stage">

    <!-- ===== CONTRACT PAGE 1 — cover, details, financial & inclusions ===== -->
    <section class="sheet" data-doc="contract">
      <div class="sheet-inner">
        ${runHead('Private booking contract', `Ref <b>${ref}</b>`)}
        <div class="body">
          <p class="cover-kicker">This agreement</p>
          <h1 class="cover-title">Private booking contract</h1>
          <p class="cover-script">Your event, secured with us</p>

          <div class="meta">
            <div class="meta-cell"><p class="meta-label">Date generated</p><p class="meta-value">${generatedDate}</p></div>
            <div class="meta-cell"><p class="meta-label">Event date</p><p class="meta-value">${eventDateTime}</p></div>
            <div class="meta-cell"><p class="meta-label">Event type</p><p class="meta-value">${safeEventType}</p></div>
          </div>

          <p class="section-label">Customer &amp; event details</p>
          <div class="detail-grid">
            <div class="drow"><span class="dk">Name</span><span class="dv">${safeCustomerName}</span></div>
            <div class="drow"><span class="dk">Phone</span><span class="dv">${safePhone}</span></div>
            <div class="drow"><span class="dk">Email</span><span class="dv">${safeEmail}</span></div>
            <div class="drow"><span class="dk">Expected guests</span><span class="dv">${guestCount}</span></div>
            <div class="drow" style="grid-column:1 / -1;"><span class="dk">Venue</span><span class="dv">${venue}</span></div>
            ${safeSpecialRequirements ? `<div class="drow" style="grid-column:1 / -1;"><span class="dk">Special requirements</span><span class="dv">${safeSpecialRequirements}</span></div>` : ''}
            ${safeAccessibilityNeeds ? `<div class="drow" style="grid-column:1 / -1;"><span class="dk">Accessibility</span><span class="dv">${safeAccessibilityNeeds}</span></div>` : ''}
            ${safeContractNote ? `<div class="drow" style="grid-column:1 / -1;"><span class="dk">Note</span><span class="dv">${safeContractNote}</span></div>` : ''}
          </div>

          <p class="section-label">Financial summary</p>
          <div class="money">
            <div class="fin">
              <div class="fin-row"><span class="fk">Original price (before discounts)</span><span class="fv">${formatCurrency(originalTotal)}</span></div>
              <div class="fin-row"><span class="fk">Subtotal</span><span class="fv">${formatCurrency(subtotal)}</span></div>
              <div class="fin-row"><span class="fk">Event balance due</span><span class="fv">${formatCurrency(balanceDue)}</span></div>
              <div class="fin-row total"><span class="fk">Total event cost</span><span class="fv">${formatCurrency(total)}</span></div>
            </div>
            <div class="deposit-box">
              <span class="db-l">Booking &amp; damage deposit</span>
              <span class="db-r">${formatCurrency(depositAmount)}</span>
              <small>Status: ${depositStatus}. Payable to confirm the booking. Separate from and additional to the event balance.</small>
            </div>
          </div>
          <p class="callout"><b>Important:</b> the deposit is separate from the event balance and cannot be used towards payment of it. The full event balance remains payable separately by the due date.</p>

          <p class="section-label">Important: services not included</p>
          <p style="font-size:10px; line-height:1.44; color:var(--ink-soft); margin:0 0 2.4mm;">This contract covers <b>only</b> the specific items and services itemised in the booking details. The following are <b>not</b> included unless explicitly itemised:</p>
          <ul class="points">
            <li><b>Bar service</b> &mdash; drinks purchased separately at standard prices.</li>
            <li><b>Waiting staff</b> &mdash; no table service unless listed.</li>
            <li><b>Linens &amp; decorations</b> &mdash; cloths, centrepieces, etc.</li>
            <li><b>Audio/visual</b> &mdash; PA, projectors, screens, mics.</li>
            <li><b>Set-up / clear-down</b> &mdash; basic prep only.</li>
            <li><b>Music / entertainment</b> &mdash; no DJ or band unless listed.</li>
            <li><b>Photography / videography</b> &mdash; unless contracted.</li>
            <li><b>Security</b> &mdash; not provided as standard.</li>
            <li><b>Additional hours</b> &mdash; extensions charged separately.</li>
          </ul>
          <p class="callout" style="margin-top:2.4mm; margin-bottom:0;"><b>Note:</b> basic tables and chairs are included with venue hire. Any service not listed must be arranged and paid for separately. Please contact us if you believe a service you need is missing.</p>
        </div>
        ${runFoot(regFull, 'Page')}
      </div>
    </section>

    <!-- ===== CONTRACT PAGE 2 — deposit info, agreement & signatures ===== -->
    <section class="sheet" data-doc="contract">
      <div class="sheet-inner">
        ${runHead('Private booking contract', `Ref <b>${ref}</b>`)}
        <div class="body">
          <p class="section-label">Deposit information</p>
          <div class="tc">
            <p>A booking and damage deposit is required to secure the desired date and time. The deposit secures the booking, removes the date and time from general availability, and protects Orange Jelly Limited, trading as The Anchor, against cancellation, damage, additional cleaning, overtime, unpaid charges, third-party supplier costs and other sums arising from the event.</p>
            <p>The booking is not confirmed until the deposit has been received in cleared funds. Before payment, Orange Jelly Limited may place a temporary hold on the date and time; a temporary hold is provisional only and may be released if the deposit is not received in cleared funds within <b>14 calendar days</b>, unless agreed otherwise in writing. The deposit may be paid by cash, card, bank transfer or PayPal, and payment of the deposit constitutes acceptance of this Agreement and these Terms and Conditions in full.</p>
            <p>The deposit is separate from and additional to the total event cost, and cannot be used as payment towards the event balance, bar spend, catering, entertainment, venue hire, supplier charges or any other event cost. If the event proceeds as booked, the deposit will be refunded within <b>48 hours</b> after the event, provided the full balance has been paid, all charges settled, and no deductions required.</p>
            <p>The Host remains responsible for significant or malicious damage, excessive or specialist cleaning, unauthorised overtime, unpaid bar tabs, missing items, supplier and staffing costs, special-order items and other costs arising from the event. Ordinary incidental wear and minor glass breakages are not charged. Where sums owed exceed the deposit, the Host must pay the balance on demand.</p>
          </div>

          <p class="section-label gap">Agreement</p>
          <div class="tc">
            <p>I, <b>${safeCustomerName}</b>, agree to engage Orange Jelly Limited, operating as The Anchor Pub, to host my event described as <b>&ldquo;${safeEventType}&rdquo;</b> on <b>${eventDate}</b> from <b>${startTime}</b> to <b>${endTime}</b>, and commit to paying the total event cost of <b>${formatCurrency(total)}</b>. To secure the booking I will pay the booking and damage deposit of <b>${formatCurrency(depositAmount)}</b>.</p>
            <p>I understand the deposit is separate from and additional to the event cost and cannot be used towards the event balance or any other charge. I understand the full event balance of <b>${formatCurrency(total)}</b> and final guest numbers are due no later than <b>${balanceDueDate}</b> (14 calendar days before the event), and that failure to pay by the due date may result in cancellation and forfeiture of the deposit, except where a refund is required by law.</p>
            <p>I understand that if I cancel <b>less than 30 calendar days</b> before the event, fail to attend, or fail to pay the balance by the due date, the deposit will be retained in full, except where a refund is required by law. If I cancel <b>30 calendar days or more</b> before the event, the deposit may be refunded less a 5% administration deduction and any direct costs already incurred or committed. By signing below, paying the deposit, or otherwise confirming in writing, I confirm I have read, understood and agree to be bound by this Agreement and its Terms and Conditions.</p>
          </div>

          <div class="sign-grid" style="margin-top:5mm;">
            <div class="sign-card">
              <p class="sign-card-h">Signed by the Host</p>
              <p class="sign-card-sub">The person booking the event</p>
              <div class="sf"><div class="sf-rule"><span class="sf-v">${safeCustomerName}</span></div><span class="sf-cap">Host name</span></div>
              <div class="sf-row">
                <div class="sf" style="margin-bottom:0;"><div class="sf-rule tall"></div><span class="sf-cap">Signature</span></div>
                <div class="sf" style="margin-bottom:0;"><div class="sf-rule tall"></div><span class="sf-cap">Date</span></div>
              </div>
            </div>
            <div class="sign-card">
              <p class="sign-card-h">For The Anchor Pub</p>
              <p class="sign-card-sub">Orange Jelly Limited</p>
              <div class="sf"><div class="sf-rule"></div><span class="sf-cap">Name &amp; position</span></div>
              <div class="sf-row">
                <div class="sf" style="margin-bottom:0;"><div class="sf-rule tall"></div><span class="sf-cap">Signature</span></div>
                <div class="sf" style="margin-bottom:0;"><div class="sf-rule tall"></div><span class="sf-cap">Date</span></div>
              </div>
            </div>
          </div>
        </div>
        ${runFoot(regShort, 'Page')}
      </div>
    </section>

    <!-- ===== CONTRACT PAGE 3 — terms (1 of 2) ===== -->
    <section class="sheet" data-doc="contract">
      <div class="sheet-inner">
        ${runHead('Private booking contract', `Ref <b>${ref}</b>`)}
        <div class="body">
          <p class="section-label">Terms &amp; conditions</p>
          <div class="tc-cols">
            <div class="tc-sec">
              <p class="tc-h">Reservation and deposit</p>
              <p>All event bookings require a booking and damage deposit as specified above. Before payment, Orange Jelly Limited may place a provisional temporary hold, which may be released if the deposit is not received in cleared funds within 14 calendar days unless agreed otherwise in writing.</p>
              <p>The booking is confirmed only when the deposit is received in cleared funds. Once received, Orange Jelly Limited may remove the date and time from availability and decline other enquiries for it. The deposit is separate from and additional to the event cost and may not be used towards the balance or any other charge.</p>
              <p>If the event proceeds as booked, the deposit is refunded within 48 hours, provided the balance is paid, charges settled and no deductions required. Orange Jelly Limited may deduct any sums owed, including damage, specialist cleaning, missing items, unpaid balances or bar tabs, overtime, supplier and staffing costs, special-order items and cancellation costs. Any shortfall is payable on demand.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Cancellation policy</p>
              <p>The Host may cancel only by written notice; the cancellation date is the date Orange Jelly Limited receives it.</p>
              <p>Cancelling <b>30 calendar days or more</b> before the event: the deposit may be refunded, less a 5% administration deduction and any direct costs, supplier charges, payment processing, staffing, special-order or other charges already incurred or committed.</p>
              <p>Cancelling <b>less than 30 calendar days</b> before the event: the deposit is retained in full, except where a refund is required by law, as the date may have been removed from availability and costs committed.</p>
              <p>Failure to attend, to pay the balance, or to confirm final numbers by the due date may be treated as cancellation by the Host, with the deposit retained in full except where a refund is required by law. Cancellation does not release the Host from sums already due or incurred. Where required by law, Orange Jelly Limited will take reasonable steps to reduce its losses, including re-selling the date where practical.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Date changes</p>
              <p>Date changes may be requested in writing and are subject to availability; they are not guaranteed unless confirmed in writing. Requests made at least 14 calendar days before the event will be accommodated with reasonable efforts where a suitable date is available.</p>
              <p>Any financial impact of a date change is payable by the Host, including supplier, entertainer, staffing and stock costs, special-order items, administration and price increases. Such costs may be deducted from the deposit, with any shortfall payable on demand. A request less than 14 calendar days before the event may be refused and treated as a cancellation.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Payment</p>
              <p>The full event balance must be paid no later than <b>14 calendar days</b> before the event, unless agreed otherwise in writing. Final guest numbers, catering, dietary and accessibility requirements and other final details must also be confirmed by then.</p>
              <p>Payment of the deposit constitutes acceptance of this Agreement in full. The deposit is separate from the balance and may not be used towards it. If the balance is not paid by the due date, Orange Jelly Limited may treat the booking as cancelled by the Host, retain the deposit in full except where a refund is required by law, and recover any further losses.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Final numbers, catering &amp; details</p>
              <p>Final guest numbers must be confirmed no later than 14 calendar days before the event, after which Orange Jelly Limited may commit staffing, catering, stock and suppliers on that basis. Reductions after the deadline do not oblige a reduction in the balance; increases are subject to availability and may incur additional charges.</p>
              <p>All allergies, dietary and accessibility requirements must be provided as early as possible and no later than 14 calendar days before the event. Requirements notified late cannot be guaranteed.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Age restrictions</p>
              <p>We adhere to the <b>Challenge 25</b> policy. Those appearing under 25 will be asked for valid ID to purchase alcohol, and those unable to provide adequate proof of age will be denied service in compliance with the law.</p>
            </div>
          </div>
        </div>
        ${runFoot(regShort, 'Page')}
      </div>
    </section>

    <!-- ===== CONTRACT PAGE 4 — terms (2 of 2) + company ===== -->
    <section class="sheet" data-doc="contract">
      <div class="sheet-inner">
        ${runHead('Private booking contract', `Ref <b>${ref}</b>`)}
        <div class="body">
          <p class="section-label">Terms &amp; conditions (continued)</p>
          <div class="tc-cols">
            <div class="tc-sec">
              <p class="tc-h">Liability</p>
              <p>Nothing in this Agreement limits or excludes Orange Jelly Limited's liability for death or personal injury caused by its negligence, fraud or fraudulent misrepresentation, or any other liability that cannot lawfully be limited or excluded. Subject to that, Orange Jelly Limited is not responsible for loss, damage, injury, delay or disruption caused by the Host, their guests, external suppliers, entertainers or contractors, or by any matter outside its reasonable control.</p>
              <p>The Host is responsible for the conduct of their guests, suppliers, entertainers and contractors, and indemnifies Orange Jelly Limited against claims, losses, damages, liabilities, costs and expenses arising from any act or omission by them.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">What's included</p>
              <p>Only the items, services and vendors explicitly listed in the booking are included. The venue provides the physical space only unless additional services are itemised. All drinks must be purchased from the bar at standard prices. The Host is responsible for arranging any services not listed.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">External catering &amp; provisions</p>
              <p>External caterers must be pre-approved and provide evidence of public liability insurance and relevant certifications, and conform to our hygiene standards; non-compliance may result in denial of entry. We provide no catering facilities and no fridge or freezer storage, so all provisions, equipment and storage must be arranged by the caterer or host. Allergies and dietary requirements should be communicated at booking; specific dietary options may incur additional costs.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Entertainment &amp; equipment</p>
              <p>Entertainers must be pre-approved and provide evidence of public liability insurance where requested. Any equipment requiring electricity (DJ and band equipment, lighting, sound, bouncy castles) must be approved in advance, be PAT tested where applicable, and be safe and well maintained. Powered equipment may incur a standing charge for power use.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Decoration and setup</p>
              <p>Decoration plans must be agreed in advance; unapproved furniture, gear or decorations are not permitted. Open flames, nails, thumbtacks and cello tape on paint or wallpaper are strictly prohibited. Set-up and decoration must be completed within the allocated one hour before and after the booking; extra time or unapproved deviations incur additional hourly charges.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Licensing and conduct</p>
              <p><b>Alcohol:</b> 11.00&ndash;00.00 Mon&ndash;Thu; 11.00&ndash;01.00 Fri&ndash;Sat; 12.00&ndash;23.30 Sun. <b>Live music/dancing:</b> 19.30&ndash;00.00 Mon&ndash;Sat; 19.30&ndash;23.30 Sun. <b>Recorded music:</b> 11.00&ndash;00.00 Mon&ndash;Sat; 12.00&ndash;23.30 Sun. <b>Late night refreshment:</b> 23.00&ndash;00.30 Mon&ndash;Thu; 23.00&ndash;01.30 Fri&ndash;Sat; 23.00&ndash;00.00 Sun.</p>
              <p>Guests are expected to conduct themselves respectfully and be considerate of our neighbours, given our location within a village.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Additional charges &amp; overtime</p>
              <p>Events running beyond the agreed timeframe incur additional hourly rates payable on demand. Services or provisions outside our standard offerings may incur additional charges.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Intellectual property</p>
              <p>Hosts may not use the logo or any branding of Orange Jelly Limited or The Anchor without explicit written permission. All intellectual property rights remain with Orange Jelly Limited.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Force majeure</p>
              <p>Neither party is liable for failure or delay caused by events beyond its reasonable control, including fire, flood, war, acts of terrorism, riots, strikes, acts of God or governmental acts. Where the event cannot proceed due to force majeure, Orange Jelly Limited may offer an alternative date where possible; if none can be agreed, any refund is assessed in accordance with applicable law.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Indemnity &amp; insurance</p>
              <p>The Host indemnifies Orange Jelly Limited, its affiliates and their directors, officers, employees and agents against claims, losses, damages, liabilities, judgements, fees, costs and expenses arising from any act or omission by the Host, their guests, suppliers, entertainers or contractors. Orange Jelly Limited's total liability for any claim is limited to the amount paid by the Host for the event. Hosts are encouraged, though not required, to consider event insurance.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Governing law</p>
              <p>This Agreement is governed by the laws of <b>England and Wales</b>. Disputes are resolved through good faith negotiation and, failing that, submitted to a competent court in England and Wales.</p>
            </div>
          </div>

          <p class="addr" style="margin-top:4mm;"><b>Orange Jelly Limited</b>, trading as The Anchor Pub &middot; Company Registration No. 10537179 &middot; VAT No. GB 315 203 647<br>The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ &middot; 01753 682 707 &middot; manager@the-anchor.pub &middot; management.orangejelly.co.uk</p>
        </div>
        ${runFoot(regShort, 'Page')}
      </div>
    </section>
${hasOwnFood ? `
    <div class="doc-divider">Optional annex &middot; self-catering food waiver</div>

    <!-- ===== WAIVER — self-catering food release & indemnity (separate signature) ===== -->
    <section class="sheet" data-doc="waiver">
      <div class="sheet-inner">
        ${runHead('Self-catering food waiver', `Optional annex &middot; Ref <b>${ref}/W</b>`)}
        <div class="body">
          <p class="cover-kicker">Optional annex &middot; complete only if food is self-catered</p>
          <h1 class="cover-title" style="font-size:26px; margin-bottom:1.6mm;">Self-catering food release &amp; indemnity waiver</h1>
          <p class="cover-script" style="font-size:17px; margin-bottom:3mm;">Signed separately from the booking contract</p>

          <div class="tc" style="margin-bottom:3mm;">
            <p>This Waiver is entered into between the undersigned Event Organiser (<b>&ldquo;Event Organiser&rdquo;</b>) and <b>Orange Jelly Limited</b> (<b>&ldquo;the Company&rdquo;</b>), operating The Anchor pub. It governs the provision and consumption of any self-catered food at events held at The Anchor. By signing below, the Event Organiser confirms they have read, understood and agree to be bound by the following terms.</p>
          </div>

          <ol class="contract" style="columns:2; column-gap:7mm;">
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Responsibility for food</h2>
              <ol class="sub">
                <li>The Event Organiser has sole responsibility for the purchase, preparation, storage, transport, presentation and service of all food provided at the event.</li>
                <li>The Event Organiser is responsible for ensuring the food is safe for consumption and handled in accordance with best practice and all applicable legal requirements.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Release of liability and indemnity</h2>
              <ol class="sub">
                <li>The Event Organiser releases, indemnifies and holds harmless Orange Jelly Limited, its directors, employees, agents and representatives from any and all claims, liabilities, losses, damages, injuries or expenses (including legal costs) arising out of or in connection with the consumption or handling of any self-catered food at the event.</li>
                <li>This release applies to any claims, including those arising from foodborne illness, allergic reactions, injury or, in the worst case, death.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Compliance with legislation</h2>
              <ol class="sub">
                <li>The Event Organiser shall ensure all provision of food complies with the <b>Food Safety Act 1990</b> and any other relevant legislation (available at legislation.gov.uk).</li>
                <li>The Event Organiser is responsible for any inspections or regulatory requirements arising in connection with the event.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Food safety and allergens</h2>
              <ol class="sub">
                <li>The Event Organiser will take all necessary precautions to maintain food safety, including ensuring no food remains at room temperature for more than <b>two (2) hours</b>; food left beyond this is deemed unsafe and must be disposed of appropriately.</li>
                <li>In accordance with the Food Information Regulations, the Event Organiser will provide accurate details of any of the 14 major allergens (celery, gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soya and sulphur dioxide/sulphites) present in any food served.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Notification to attendees</h2>
              <ol class="sub">
                <li>The Event Organiser will ensure all attendees are clearly informed the event is self-catered and that Orange Jelly Limited provides no catering services, food preparation or storage facilities.</li>
                <li>Any external catering providers used must be fully self-sufficient.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Storage and cleanliness</h2>
              <ol class="sub">
                <li>No storage facilities, including refrigeration or freezer storage, are available at The Anchor. All food must be transported to the venue at the start of the event and stored safely in compliance with food safety regulations.</li>
                <li>The Event Organiser is responsible for the cleanliness of the area used for food preparation and consumption, including proper disposal of unused food and rubbish.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Insurance</h2>
              <ol class="sub">
                <li>Orange Jelly Limited does not extend any insurance coverage to the event or the self-catered food provided.</li>
                <li>Any claims arising from the event, including those related to food safety or consumption, are the sole responsibility of the Event Organiser.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Entire agreement &amp; governing law</h2>
              <ol class="sub">
                <li>This Waiver represents the entire agreement regarding self-catered food provision and supersedes all prior discussions or agreements.</li>
                <li>Any amendments must be in writing and signed by both parties.</li>
                <li>This Waiver is governed by the laws of England and Wales, with disputes subject to the exclusive jurisdiction of its courts.</li>
              </ol>
            </li>
          </ol>

          <p class="sign-intro" style="margin:4mm 0 3mm;">By signing below, the Event Organiser confirms agreement to all the above terms and acknowledges they have had the opportunity to seek independent advice if desired. <b>This signature is separate from, and additional to, the signature on the private booking contract.</b></p>

          <div class="sign-grid">
            <div class="sign-card">
              <p class="sign-card-h">Event details</p>
              <p class="sign-card-sub">Completed by the Event Organiser</p>
              <div class="sf"><div class="sf-rule"><span class="sf-v">${eventDate}</span></div><span class="sf-cap">Event date</span></div>
              <div class="sf" style="margin-bottom:0;"><div class="sf-rule"><span class="sf-v">${waiverEventDetails}</span></div><span class="sf-cap">Event details</span></div>
            </div>
            <div class="sign-card">
              <p class="sign-card-h">Signed by the Event Organiser</p>
              <p class="sign-card-sub">Self-catering food waiver</p>
              <div class="sf"><div class="sf-rule"><span class="sf-v">${safeCustomerName}</span></div><span class="sf-cap">Event organiser's name</span></div>
              <div class="sf-row">
                <div class="sf" style="margin-bottom:0;"><div class="sf-rule tall"></div><span class="sf-cap">Signature</span></div>
                <div class="sf" style="margin-bottom:0;"><div class="sf-rule tall"></div><span class="sf-cap">Date</span></div>
              </div>
            </div>
          </div>
        </div>
        ${runFoot(regWaiver, 'Waiver page')}
      </div>
    </section>
` : ''}
  </div>

  <script>
    (function(){
      ['contract','waiver'].forEach(function(doc){
        var sheets = document.querySelectorAll('.sheet[data-doc="' + doc + '"]');
        var total = sheets.length;
        sheets.forEach(function(sheet, i){
          var no = sheet.querySelector('.pageno');
          var tot = sheet.querySelector('.pagetot');
          if (no) no.textContent = i + 1;
          if (tot) tot.textContent = total;
        });
      });
    })();
  </script>

</body>
</html>`
}
