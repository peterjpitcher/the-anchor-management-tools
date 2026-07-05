import { PrivateBookingWithDetails, PrivateBookingItem } from '@/types/private-bookings'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import { computeBookingMoney } from '@/lib/private-bookings/vat'
import { logger } from '@/lib/logger'

export interface ContractData {
  booking: PrivateBookingWithDetails
  logoUrl?: string
  /** Version recorded against the booking for this generation — rendered in the page footer. */
  contractVersion?: number
  companyDetails?: {
    name: string
    registrationNumber?: string
    vatNumber?: string
    address: string
    phone: string
    email: string
    privacyNoticeUrl?: string
  }
}

// Canonical company details (SOP rewording pack §30). Used when the caller does not
// supply companyDetails; callers may override individual values.
const DEFAULT_COMPANY_DETAILS = {
  name: 'Orange Jelly Limited trading as The Anchor Pub',
  registrationNumber: '10537179',
  vatNumber: 'GB 315 2036 47',
  address: 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ',
  phone: '01753 682707',
  email: 'manager@the-anchor.pub',
  privacyNoticeUrl: 'https://www.the-anchor.pub/privacy-policy'
} as const

// The "Bring Your Own Food" catering package (see
// supabase/migrations/20260405120000_standardise_catering_options.sql). When a booking
// includes this package, the optional self-catering and outside food responsibility
// agreement annex is appended to the contract. Matched by fixed id first, with a name
// fallback so a re-seeded or renamed package (different id, similar name) still
// triggers the annex.
const BYO_FOOD_PACKAGE_ID = '9fdbf82b-6717-4bff-8af6-8865cb5bfe21'

// Name patterns that indicate a self-catered event. Deliberately broad: a re-seeded
// package renamed to e.g. "Self-Catering" or "BYO Buffet" must still append the waiver.
const SELF_CATERING_NAME_PATTERNS: readonly RegExp[] = [
  /bring your own/,
  /self[\s-]?cater/,
  /\bbyo\b/
]

// Exported for unit tests. True when a catering package name reads as self-catering.
export function matchesSelfCateringPackageName(name: string | null | undefined): boolean {
  const normalised = (name || '').trim().toLowerCase()
  if (!normalised) return false
  return SELF_CATERING_NAME_PATTERNS.some((pattern) => pattern.test(normalised))
}

/**
 * True when the booking's items include a catering package that requires the
 * self-catering / outside food responsibility annex. Flag-first
 * (catering_packages.requires_waiver, SOP §21); the fixed package id and name
 * patterns remain as fallbacks for rows created before the flag existed.
 * Shared with the contract lifecycle so the "waiver sent" stamp uses the same
 * detection as the rendered document.
 */
export function bookingRequiresWaiverAnnex(booking: {
  id?: string
  items?: PrivateBookingItem[] | null
}): boolean {
  return (booking.items || []).some((item: PrivateBookingItem) => {
    if (item.item_type !== 'catering') return false
    if (item.package?.requires_waiver === true) return true
    if (item.package?.id === BYO_FOOD_PACKAGE_ID) return true
    if (matchesSelfCateringPackageName(item.package?.name)) {
      // The name reads as self-catering but neither the waiver flag nor the
      // known package id matched — the seeded data has probably drifted. Warn
      // so requires_waiver / BYO_FOOD_PACKAGE_ID get updated.
      logger.warn('Self-catering waiver matched by package name, not by known package id', {
        metadata: {
          bookingId: booking.id || null,
          packageId: item.package?.id || null,
          packageName: item.package?.name || null
        }
      })
      return true
    }
    return false
  })
}

export function generateContractHTML(data: ContractData): string {
  const { booking, logoUrl, companyDetails, contractVersion } = data

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
  const round2 = (n: number) => Math.round(n * 100) / 100

  // ---- company details (rewording pack §30 — consistent everywhere) ----
  const company = {
    name: escapeHtml(companyDetails?.name || DEFAULT_COMPANY_DETAILS.name),
    registrationNumber: escapeHtml(companyDetails?.registrationNumber || DEFAULT_COMPANY_DETAILS.registrationNumber),
    vatNumber: escapeHtml(companyDetails?.vatNumber || DEFAULT_COMPANY_DETAILS.vatNumber),
    address: escapeHtml(companyDetails?.address || DEFAULT_COMPANY_DETAILS.address),
    phone: escapeHtml(companyDetails?.phone || DEFAULT_COMPANY_DETAILS.phone),
    email: escapeHtml(companyDetails?.email || DEFAULT_COMPANY_DETAILS.email),
    privacyNoticeUrl: escapeHtml(companyDetails?.privacyNoticeUrl || DEFAULT_COMPANY_DETAILS.privacyNoticeUrl)
  }

  // ---- financial calculations (rewording pack §31) ----
  // Stored unit prices are NET (owner-confirmed). Customer-facing totals must be
  // VAT-inclusive with the VAT element disclosed — computeBookingMoney owns the maths.
  const items = booking.items || []
  const money = computeBookingMoney(items, booking.discount_type, booking.discount_amount)

  // Original net price before any discounts (item-level or booking-level)
  const originalNet = items.reduce((sum: number, item: PrivateBookingItem) => {
    const qty = typeof item.quantity === 'string' ? parseFloat(item.quantity) : item.quantity
    const price = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : item.unit_price
    return sum + ((qty || 0) * (price || 0))
  }, 0)
  const discountTotal = Math.max(0, round2(originalNet - money.discountedNet))

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
  // deposit_amount can be NULL in the database (e.g. venue-hosted events that are
  // exempt from deposit rules). Never invent an amount here — a NULL/0 deposit renders
  // as "No deposit required". The £250 default belongs on the booking form only.
  const rawDepositAmount =
    typeof booking.deposit_amount === 'string' ? parseFloat(booking.deposit_amount) : booking.deposit_amount
  const depositAmount = Number.isFinite(rawDepositAmount) ? Number(rawDepositAmount) : 0
  const depositRequired = depositAmount > 0
  const eventPriceGross = money.grossTotal
  const totalToPay = round2(eventPriceGross + depositAmount)

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
  const venue = company.address

  // ---- deposit-dependent fragments ----
  // When no deposit is stored the contract must not demand one; wording stays calm.
  const depositBoxHtml = depositRequired
    ? `<div class="deposit-box">
              <span class="db-l">Booking &amp; damage deposit</span>
              <span class="db-r">${formatCurrency(depositAmount)}</span>
              <small>Status: ${depositStatus}. Payable to confirm the booking. Held separately from the event price and refundable after the event, less any documented deductions.</small>
            </div>`
    : `<div class="deposit-box">
              <span class="db-l">Booking &amp; damage deposit</span>
              <span class="db-r" style="font-size:17px;">No deposit required</span>
              <small>No booking deposit is payable for this event.${booking.deposit_paid_date ? ` A deposit payment was recorded on ${formatDate(booking.deposit_paid_date)}.` : ''}</small>
            </div>`
  // Customer note (rewording pack §31)
  const depositCalloutHtml = depositRequired
    ? `<p class="callout">The booking and damage deposit is separate from the event price. It cannot be used towards the event balance, bar spend, catering, entertainment, venue hire, supplier charges or any other event cost. If the event proceeds as booked, the deposit will be processed for refund within 48 hours after the event, less any documented deductions.</p>`
    : `<p class="callout">No booking and damage deposit is payable for this event. The full event balance remains payable by the due date.</p>`

  // ---- self-catering (bring your own food) detection ----
  // Flag-first (catering_packages.requires_waiver); id/name matching is a fallback.
  const hasOwnFood = bookingRequiresWaiverAnnex(booking)

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

  const versionLine = contractVersion
    ? ` &middot; Contract version ${contractVersion} &middot; generated ${generatedDate}`
    : ''
  const regLegal = `<b>${company.name}</b> &middot; Registered in England &amp; Wales no. ${company.registrationNumber} &middot; VAT ${company.vatNumber}`
  const regFull = `<b>${company.name}</b> &middot; ${company.address} &middot; Registered in England &amp; Wales no. ${company.registrationNumber} &middot; VAT ${company.vatNumber}${versionLine}`
  const regShort = `${regLegal}${versionLine}`
  const regWaiver = `<b>${company.name}</b> &middot; Self-catering and outside food agreement &middot; Registered in England &amp; Wales no. ${company.registrationNumber} &middot; VAT ${company.vatNumber}${versionLine}`

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
    <strong>The Anchor — Private booking contract.</strong> ${safeCustomerName} &middot; ${safeEventType} &middot; ${eventDate} &middot; ref ${ref}.${hasOwnFood ? ' Followed by an <strong>optional self-catering and outside food responsibility agreement</strong> (separate annex, separate signature).' : ''}
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
              <div class="fin-row"><span class="fk">Original event price before discounts (excl. VAT)</span><span class="fv">${formatCurrency(originalNet)}</span></div>
              <div class="fin-row"><span class="fk">Discounts (excl. VAT)</span><span class="fv">${discountTotal > 0 ? `&minus;${formatCurrency(discountTotal)}` : formatCurrency(0)}</span></div>
              <div class="fin-row"><span class="fk">Event price, excluding deposit</span><span class="fv">${formatCurrency(eventPriceGross)}</span></div>
              <div class="fin-row"><span class="fk">VAT included in event price</span><span class="fv">${formatCurrency(money.vatAmount)}</span></div>
              <div class="fin-row"><span class="fk">Booking and damage deposit (held separately)</span><span class="fv">${depositRequired ? formatCurrency(depositAmount) : 'None'}</span></div>
              <div class="fin-row total"><span class="fk">Total to pay before the event</span><span class="fv">${formatCurrency(totalToPay)}</span></div>
              <div class="fin-row"><span class="fk">Amount potentially returnable after the event</span><span class="fv">${formatCurrency(depositAmount)}</span></div>
            </div>
            ${depositBoxHtml}
          </div>
          ${depositCalloutHtml}

          <p class="section-label">What&rsquo;s included &mdash; and what&rsquo;s not</p>
          <p style="font-size:10px; line-height:1.44; color:var(--ink-soft); margin:0 0 1.6mm;">Only the items, services, spaces, packages and vendors listed in this booking are included. Unless the booking says otherwise, standard venue hire includes tables and chairs, basic room layout, bar service, one hour of setup access before the booking, one hour of clear-down access after, use of toilets, use of the booked area, normal cleaning after ordinary use, and the General Manager or duty manager as your event contact.</p>
          <p style="font-size:10px; line-height:1.44; color:var(--ink-soft); margin:0 0 2.4mm;">The following are not included unless explicitly itemised:</p>
          <ul class="points">
            <li>Waiting staff or table service</li>
            <li>Linen, decorations and centrepieces</li>
            <li>Catering</li>
            <li>DJ, band or other entertainment</li>
            <li>Projector, screen or microphone</li>
            <li>Photography or videography</li>
            <li>Security</li>
            <li>Private bar or exclusive venue hire</li>
            <li>Extra setup or clear-down time</li>
            <li>Removal of rubbish from outside food, decorations or supplier items</li>
          </ul>
          <p class="callout" style="margin-top:2.4mm; margin-bottom:0;">All drinks must be purchased from The Anchor. External drinks are not permitted. If a service you need is not listed, please talk to us before the event so we can arrange it.</p>
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
${depositRequired ? `            <p>A booking and damage deposit is required to secure the date and time shown in this contract. The deposit secures the booking, removes the date and time from general availability, and protects The Anchor against reasonable cancellation losses, damage, missing items, specialist cleaning, unauthorised overtime, unpaid charges, supplier costs, special-order items and other sums arising from the event.</p>
            <p>The booking is not confirmed until the deposit has been received in cleared funds and The Anchor has issued written confirmation. Before payment, The Anchor may place a provisional hold on the date and time. A provisional hold is not a confirmed booking and may be released if the deposit is not received in cleared funds by the hold expiry date, unless The Anchor agrees otherwise in writing.</p>
            <p>The deposit is separate from and additional to the event price. It cannot be used as payment towards the event balance, bar spend, catering, entertainment, venue hire, supplier charges or any other event cost.</p>
            <p>If the event proceeds as booked, The Anchor will process the deposit refund within <b>48 hours</b> after the event, provided the full balance has been paid, all agreed charges have been settled, and no deductions are required. The Anchor may use this 48-hour period to inspect the premises and complete cleaning checks.</p>
            <p>Any proposed deduction will be documented and discussed with the Host before it is made. Ordinary incidental wear and minor glass breakages are not charged. Where sums owed exceed the deposit, the Host must pay the balance on demand.</p>` : `            <p>No booking deposit is required for this event. The booking is confirmed once agreed in writing with The Anchor.</p>
            <p>The Host remains responsible for reasonable costs arising from the event, including damage, missing items, specialist cleaning, unauthorised overtime, unpaid charges, supplier costs and special-order items, which are payable on demand. Ordinary incidental wear and minor glass breakages are not charged. Any proposed charge will be documented and discussed with the Host before it is made.</p>`}
          </div>

          <p class="section-label gap">Agreement</p>
          <div class="tc">
${depositRequired ? `            <p>I, <b>${safeCustomerName}</b>, agree to engage Orange Jelly Limited trading as The Anchor Pub to host my event described as <b>&ldquo;${safeEventType}&rdquo;</b> on <b>${eventDate}</b> from <b>${startTime}</b> to <b>${endTime}</b> at ${venue}.</p>
            <p>I agree to pay the event price of <b>${formatCurrency(eventPriceGross)}</b> (including VAT) and the separate booking and damage deposit of <b>${formatCurrency(depositAmount)}</b>. I understand that the deposit is separate from and additional to the event price and cannot be used towards the event balance or any other charge.</p>
            <p>The full event balance, final guest numbers, catering choices, supplier details, entertainment details, decoration plans, running order, allergy information, dietary requirements and accessibility requirements are due no later than <b>${balanceDueDate}</b>, being 14 calendar days before the event, unless The Anchor has agreed a different written deadline.</p>
            <p>If I provide final details late, I understand The Anchor will try to help where reasonably possible, but preferred menus, suppliers, layouts, timings, equipment or other options may no longer be available. If essential details or payment remain outstanding after reminder and General Manager review, The Anchor may treat the booking as cancelled by me.</p>
            <p>By signing below, paying the deposit, or otherwise confirming the booking in writing after receiving this Agreement, I confirm that I have read, understood and agree to be bound by this Agreement and its terms and conditions.</p>` : `            <p>I, <b>${safeCustomerName}</b>, agree to engage Orange Jelly Limited trading as The Anchor Pub to host my event described as <b>&ldquo;${safeEventType}&rdquo;</b> on <b>${eventDate}</b> from <b>${startTime}</b> to <b>${endTime}</b> at ${venue}.</p>
            <p>I agree to pay the event price of <b>${formatCurrency(eventPriceGross)}</b> (including VAT). No booking and damage deposit is required for this event.</p>
            <p>The full event balance, final guest numbers, catering choices, supplier details, entertainment details, decoration plans, running order, allergy information, dietary requirements and accessibility requirements are due no later than <b>${balanceDueDate}</b>, being 14 calendar days before the event, unless The Anchor has agreed a different written deadline.</p>
            <p>If I provide final details late, I understand The Anchor will try to help where reasonably possible, but preferred menus, suppliers, layouts, timings, equipment or other options may no longer be available. If essential details or payment remain outstanding after reminder and General Manager review, The Anchor may treat the booking as cancelled by me.</p>
            <p>By signing below or otherwise confirming the booking in writing after receiving this Agreement, I confirm that I have read, understood and agree to be bound by this Agreement and its terms and conditions.</p>`}
          </div>

          <div class="sign-grid" style="margin-top:5mm;">
            <div class="sign-card">
              <p class="sign-card-h">Signed by the Host</p>
              <p class="sign-card-sub">The person booking and accepting responsibility for the event</p>
              <div class="sf"><div class="sf-rule"><span class="sf-v">${safeCustomerName}</span></div><span class="sf-cap">Host name</span></div>
              <div class="sf-row">
                <div class="sf" style="margin-bottom:0;"><div class="sf-rule tall"></div><span class="sf-cap">Signature</span></div>
                <div class="sf" style="margin-bottom:0;"><div class="sf-rule tall"></div><span class="sf-cap">Date</span></div>
              </div>
            </div>
            <div class="sign-card">
              <p class="sign-card-h">For The Anchor</p>
              <p class="sign-card-sub">For and on behalf of Orange Jelly Limited trading as The Anchor Pub</p>
              <div class="sf"><div class="sf-rule"><span class="sf-v">Billy Summers &middot; Tenant &amp; General Manager</span></div><span class="sf-cap">Name &amp; position</span></div>
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
              <p class="tc-h">The parties and definitions</p>
              <p>In this Agreement, &ldquo;The Anchor&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo; and &ldquo;our&rdquo; mean <b>Orange Jelly Limited trading as The Anchor Pub</b>, company registration number ${company.registrationNumber}, VAT number ${company.vatNumber}, of ${company.address}. &ldquo;Host&rdquo; means the person booking and accepting responsibility for the event. &ldquo;Agreement&rdquo; means the booking agreement, these terms, and any signed annex or approved booking schedule. &ldquo;Event&rdquo; means the private booking described in the booking schedule.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Reservation and deposit</p>
              <p>A booking and damage deposit is required to secure the date and time shown in the booking schedule, unless the financial summary states that no deposit is payable. Before payment, The Anchor may place a provisional hold on the date and time. A provisional hold is not a confirmed booking and may be released if the deposit is not received in cleared funds by the hold expiry date, unless The Anchor agrees otherwise in writing. The booking is confirmed only when the deposit has been received in cleared funds and The Anchor has issued written confirmation.</p>
              <p>The deposit is separate from and additional to the event price and cannot be used towards the event balance, bar spend, catering, entertainment, venue hire, supplier charges or any other event cost. If the event proceeds as booked, the deposit refund is processed within 48 hours after the event, provided the full balance has been paid, all agreed charges have been settled and no deductions are required. The Anchor may use this 48-hour period to inspect the premises and complete cleaning checks.</p>
              <p>Any proposed deduction will be documented and discussed with the Host before it is made. Ordinary incidental wear and minor glass breakages are not charged. Where sums owed exceed the deposit, the Host must pay the balance on demand.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Cancellation</p>
              <p>The Host may cancel only by written notice, sent by email to ${company.email} or by WhatsApp or text message to a number used by The Anchor for the booking. A telephone call alone does not cancel the booking. The cancellation date is the date and time The Anchor receives the written cancellation.</p>
              <p>If the Host cancels <b>30 calendar days or more</b> before the event, The Anchor will refund the deposit less a 5% administration deduction calculated from the deposit and any direct costs, supplier charges, staffing costs, special-order items, payment costs or other costs already incurred or committed in connection with the booking.</p>
              <p>If the Host cancels <b>less than 30 calendar days</b> before the event, The Anchor may retain up to the full deposit to cover reasonable losses and costs arising from the cancellation, including lost availability, administration, staffing, supplier costs, special-order items and other committed costs. The Anchor will not retain more than is reasonable in the circumstances and will not charge twice for the same loss.</p>
              <p>If the Host fails to attend, fails to pay the balance by the due date, or fails to provide essential final details after reminder and General Manager review, The Anchor may treat the booking as cancelled by the Host and apply this cancellation policy.</p>
              <p>Cancellation does not release the Host from sums already due or reasonably incurred before cancellation. Any balance paid for services not provided will be reviewed and refunded where appropriate, less any sums The Anchor is entitled to retain or recover under this Agreement or applicable law. Where required by law, The Anchor will take reasonable steps to reduce its losses, including re-selling the date where practical.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Date changes</p>
              <p>Date changes must be requested in writing and are subject to availability. A date change is not confirmed unless The Anchor confirms it in writing. Where a date change is requested at least 14 calendar days before the event, The Anchor will make reasonable efforts to accommodate the request if a suitable date is available. The Host remains responsible for any financial impact, including supplier, entertainer, staffing, stock, special-order, administration and price increase costs.</p>
              <p>A request made less than 14 calendar days before the event may be refused or treated as cancellation unless The Anchor agrees otherwise in writing.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Payment and final details</p>
              <p>The full event balance must be paid no later than <b>14 calendar days</b> before the event unless The Anchor agrees otherwise in writing. Final guest numbers, catering choices, supplier details, entertainment details, decoration plans, running order, allergy information, dietary requirements and accessibility requirements must also be confirmed by that date.</p>
              <p>After the final details deadline, The Anchor may commit staffing, catering, stock and suppliers based on the information provided. Reductions after the deadline do not automatically reduce the event price. Increases are subject to capacity, staffing, stock, supplier availability and any additional charges. Late requirements cannot always be guaranteed, but The Anchor will consider reasonable adjustments and practical changes where possible.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Additional charges</p>
              <p>The Host must pay any agreed additional charges and any reasonable costs caused by the Host, guests, suppliers, entertainers or contractors.</p>
              <p>Approved high-power or amplified equipment, including DJ, band, lighting, inflatable, bouncy castle or similar equipment, attracts a <b>£25 electricity charge</b>. The Anchor may refuse, limit, disconnect or require removal of equipment that is unsafe, excessive, not PAT-tested where applicable, likely to overload circuits, likely to cause nuisance, or not approved in advance.</p>
              <p>Additional staffing, where required or agreed, is charged at <b>£20 per staff-hour</b> unless agreed otherwise in writing. Extra venue hire time is subject to availability, General Manager approval and the applicable space hire rate. Specialist cleaning, damage, missing items, supplier costs and special-order costs may be charged at the reasonable cost incurred. Any proposed deduction from the deposit will be documented and discussed with the Host before it is made.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Outside food and external catering</p>
              <p>Outside food, self-catering and external caterers are allowed only with prior written approval from The Anchor. Where outside food is approved, the Host must sign the self-catering and outside food responsibility agreement before the event.</p>
              <p>The Anchor provides no kitchen access, food preparation facilities, heating facilities, refrigeration, freezer space or storage for outside food. Slow cookers, hot plates, heated trays and similar equipment are not permitted. The Host and any external caterer are responsible for the purchase, preparation, transport, storage, presentation, service, allergen information, safety and removal of outside food, and outside food and associated rubbish must be removed at the end of the event unless The Anchor agrees otherwise in writing.</p>
              <p>External caterers must be pre-approved and must provide documents requested by The Anchor no later than 14 calendar days before the event, including public liability insurance, food hygiene evidence, food business registration where applicable, risk assessments, method statements and allergen information.</p>
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
              <p class="tc-h">Entertainment &amp; equipment</p>
              <p>Entertainment, DJs, bands, live music, recorded music, karaoke, quizzes, inflatables, AV equipment and other external equipment must be approved in advance. The Host must provide supplier details and required documents no later than 14 calendar days before the event. The Anchor may refuse entry to any unapproved supplier or equipment.</p>
              <p>Equipment requiring electricity must be approved in advance, safe, well maintained and PAT-tested where applicable. The Anchor may refuse, limit, disconnect or require removal of unsafe, excessive or unapproved equipment. All entertainment and equipment must comply with the premises licence, noise controls, public nuisance requirements, safety requirements, setup and clear-down times, and staff instructions.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Decoration and setup</p>
              <p>Decoration plans must be agreed in advance. No unapproved furniture, equipment, decorations, fixtures or fittings are permitted. Confetti cannons, glitter, glue dots, Sellotape, adhesive tape, Blu Tack, nails, screws, staples, pins, tacks, smoke, powder, pyrotechnics, flame effects, staining products and messy reveal products are not permitted. Open flames are not permitted except brief cake candles under adult supervision.</p>
              <p>Decorations must not damage the premises, block exits, obstruct walkways, cover signs, interfere with fire equipment, affect other guests, create a nuisance or breach the premises licence. Set-up and clear-down must be completed within the allocated periods unless The Anchor agrees otherwise in writing; extra time is subject to availability and additional charges.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Licensing, alcohol and conduct</p>
              <p>The event is subject to the premises licence, licensing law, staff discretion and the licensing objectives. <b>Alcohol:</b> 11.00&ndash;00.00 Mon&ndash;Thu; 11.00&ndash;01.00 Fri&ndash;Sat; 12.00&ndash;23.30 Sun. <b>Live music/dancing:</b> 19.30&ndash;00.00 Mon&ndash;Sat; 19.30&ndash;23.30 Sun. <b>Recorded music:</b> 11.00&ndash;00.00 Mon&ndash;Sat; 12.00&ndash;23.30 Sun. <b>Late night refreshment:</b> 23.00&ndash;00.30 Mon&ndash;Thu; 23.00&ndash;01.30 Fri&ndash;Sat; 23.00&ndash;00.00 Sun. Seasonal or non-standard hours apply only where permitted by the premises licence and confirmed by The Anchor in writing.</p>
              <p>The Anchor operates <b>Challenge 25</b>. Anyone who appears under 25 may be asked for accepted photographic ID before being served alcohol, and anyone unable to provide accepted ID will be refused alcohol. The Anchor may lawfully refuse service, remove guests, stop music, close the bar or end the event early where reasonably necessary for licensing, safety, public nuisance, intoxication, illegal drugs, suspected underage drinking, suspected proxy purchasing, disorder, harassment, external alcohol, neighbour impact, safeguarding, staff welfare or breach of this Agreement.</p>
              <p>Illegal drugs are not permitted. Anyone bringing illegal drugs onto the premises will be asked to leave and may be reported to the police.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Children and supervision</p>
              <p>The Host is responsible for the conduct and supervision of all guests, including children and under-18s. The Anchor does not provide childcare or child supervision. Under-18s must be accompanied and supervised by responsible adults. The premises licence admits children only if accompanied and supervised by adults between 11.00 and 21.00, except in the dining area where this extends to 23.00. Children are not allowed in the pool table area unless supervised by an adult.</p>
              <p>If responsible adults leave, under-18s in their care may be asked to leave. Children and under-18s must not obstruct normal service, disturb other guests, create safety issues or interfere with other bookings. Nothing in this clause excludes The Anchor&rsquo;s liability for its own negligence or legal duties.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Accessibility and allergies</p>
              <p>Please tell The Anchor about allergy, dietary and accessibility requirements as early as possible and no later than 14 calendar days before the event. The Anchor will make reasonable efforts to accommodate dietary and allergy requirements where it is providing food or drink. Allergen information for The Anchor&rsquo;s food and drink is available at the-anchor.pub.</p>
              <p>The Anchor will consider reasonable adjustments for disabled guests. Late requests may limit what can be arranged, but they will still be considered. The main pub area, dining room and garden have step-free access via a ramp or step-free route; the pool table area has a small step. The Anchor does not have accessible toilets &mdash; please discuss access needs with the General Manager before booking if this may affect your event.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Liability</p>
              <p>Nothing in this Agreement limits or excludes The Anchor&rsquo;s liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, breach of statutory consumer rights that cannot lawfully be limited, or any other liability that cannot lawfully be excluded or restricted.</p>
              <p>Subject to that, The Anchor is not responsible for loss, damage, injury, delay, disruption or cost caused by the Host, guests, external suppliers, entertainers or contractors, or by events outside The Anchor&rsquo;s reasonable control. The Anchor is responsible for providing its services with reasonable care and skill, and is not responsible for arrangements or services supplied by the Host&rsquo;s own suppliers unless The Anchor has expressly agreed in writing to provide them.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Host responsibility and reimbursement</p>
              <p>The Host is responsible for the conduct of their guests, suppliers, entertainers and contractors. The Host must reimburse The Anchor for direct and reasonably foreseeable losses, costs, damages, claims, charges and expenses caused by the Host, guests, suppliers, entertainers or contractors, including breach of this Agreement, negligence, deliberate misconduct, damage, missing items, specialist cleaning, unauthorised overtime, external food issues, supplier failures, illegal drugs, external alcohol or breach of venue rules.</p>
              <p>This reimbursement obligation does not apply to the extent that the loss or cost was caused by The Anchor&rsquo;s own negligence, breach of contract, breach of statutory duty or other legal responsibility.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Force majeure and venue cancellation</p>
              <p>Neither party is liable for failure or delay caused by events beyond its reasonable control, including fire, flood, severe weather, power failure, epidemic, act of terrorism, civil disorder, strike, government restriction, licensing restriction or serious safety issue. If the event cannot proceed because of such an event, The Anchor may offer a reasonable alternative date where possible; if no alternative can be agreed, any refund will be assessed according to the services not provided, costs already incurred or committed, and applicable law.</p>
              <p>If The Anchor cancels the booking for reasons not caused by the Host and not caused by an event outside The Anchor&rsquo;s reasonable control, The Anchor will offer a reasonable alternative date where possible or refund sums paid for services not provided. The Anchor is not responsible for third-party costs incurred by the Host unless caused by The Anchor&rsquo;s breach or negligence.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Complaints</p>
              <p>Complaints should be sent to ${company.email} or to ${company.address}. The Anchor will acknowledge complaints within 3 working days and aims to provide a full response within 10 working days; if more time is needed, The Anchor will explain why and give a revised response date. Complaints are handled by the General Manager. If a complaint cannot be resolved, either party may use the courts of England and Wales.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Privacy</p>
              <p>The Anchor uses personal data to handle enquiries, manage and deliver bookings, take payments, send booking communications, manage safety and licensing obligations, record allergy, dietary and accessibility requirements, handle complaints, resolve disputes and meet legal and accounting obligations. Where necessary, The Anchor may share relevant information with staff, approved suppliers, payment providers, professional advisers, insurers, licensing authorities, police or other authorities.</p>
              <p>Marketing consent is separate from booking acceptance and can be withdrawn at any time. For more information, including retention periods and data rights, see the privacy notice at ${company.privacyNoticeUrl}.</p>
            </div>
            <div class="tc-sec">
              <p class="tc-h">Governing law</p>
              <p>This Agreement is governed by the laws of <b>England and Wales</b>. The courts of England and Wales have jurisdiction, subject to any mandatory consumer rights that apply.</p>
            </div>
          </div>

          <p class="addr" style="margin-top:4mm;"><b>${company.name}</b> &middot; Company registration number ${company.registrationNumber} &middot; VAT number ${company.vatNumber}<br>${company.address} &middot; ${company.phone} &middot; ${company.email} &middot; Privacy notice: ${company.privacyNoticeUrl}</p>
        </div>
        ${runFoot(regShort, 'Page')}
      </div>
    </section>
${hasOwnFood ? `
    <div class="doc-divider">Optional annex &middot; self-catering and outside food agreement</div>

    <!-- ===== ANNEX — self-catering and outside food responsibility agreement (separate signature) ===== -->
    <section class="sheet" data-doc="waiver">
      <div class="sheet-inner">
        ${runHead('Self-catering &amp; outside food agreement', `Optional annex &middot; Ref <b>${ref}/W</b>`)}
        <div class="body">
          <p class="cover-kicker">Optional annex &middot; complete only where outside food, self-catering, cake or external catering is approved</p>
          <h1 class="cover-title" style="font-size:26px; margin-bottom:1.6mm;">Self-catering and outside food responsibility agreement</h1>
          <p class="cover-script" style="font-size:17px; margin-bottom:3mm;">Signed separately from the private booking contract</p>

          <div class="tc" style="margin-bottom:3mm;">
            <p>This self-catering and outside food responsibility agreement is entered into between the undersigned Event Organiser and <b>${company.name}</b> (&ldquo;The Anchor&rdquo;). It applies where the Event Organiser provides, arranges or allows any outside food at The Anchor, including self-catered food, external caterer food, buffet food, hot food, cakes or other food not supplied by The Anchor. By signing, the Event Organiser confirms that they understand and accept responsibility for outside food at the event, subject to the limits set out below.</p>
          </div>

          <ol class="contract" style="columns:2; column-gap:7mm;">
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Responsibility for outside food</h2>
              <ol class="sub">
                <li>The Event Organiser is responsible for the purchase, preparation, cooking, transport, storage, temperature control, presentation, service, allergen information, safety, removal and disposal of all outside food.</li>
                <li>The Event Organiser must ensure that outside food is safe for consumption and handled in line with all applicable food safety requirements and good hygiene practice.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">No facilities provided</h2>
              <ol class="sub">
                <li>The Anchor provides no kitchen access, food preparation facilities, heating facilities, refrigeration, freezer space or storage for outside food.</li>
                <li>Slow cookers, hot plates, heated trays and similar equipment are not permitted.</li>
                <li>Outside food must be brought to the venue at the start of the event, kept safe by the Event Organiser or their caterer, and removed at the end of the event.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">External caterers</h2>
              <ol class="sub">
                <li>Any external caterer must be approved by The Anchor before the event. The Event Organiser must provide all documents requested by The Anchor no later than 14 calendar days before the event, including public liability insurance, food hygiene evidence, food business registration where applicable, risk assessments, method statements and allergen information.</li>
                <li>The Anchor may refuse entry to any caterer or food provider that has not been approved.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Food safety and disposal</h2>
              <ol class="sub">
                <li>The Event Organiser must take all reasonable precautions to keep food safe, including safe transport, temperature control, protection from contamination, safe service and prompt disposal of unsafe food.</li>
                <li>As a house rule, outside food must not be left at room temperature for more than <b>two hours</b> unless the Event Organiser or caterer can demonstrate that it is being kept safely. Food that appears unsafe may be required to be removed or disposed of.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Allergens</h2>
              <ol class="sub">
                <li>The Event Organiser must provide accurate allergen information for outside food and must make that information available to attendees.</li>
                <li>The 14 regulated allergen groups are celery, cereals containing gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, peanuts, sesame, soybeans, sulphur dioxide and sulphites, and tree nuts.</li>
                <li>The Event Organiser must not suggest that The Anchor has prepared, checked or approved allergen information for outside food unless The Anchor has expressly confirmed this in writing.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Attendee notice</h2>
              <ol class="sub">
                <li>The Event Organiser must ensure that attendees understand which food is outside food and that The Anchor has not prepared, stored, heated, chilled or served that food unless expressly agreed in writing.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Cleaning and rubbish</h2>
              <ol class="sub">
                <li>The Event Organiser is responsible for keeping the outside food area clean during the event and for removing all outside food, packaging, leftovers and associated rubbish at the end of the event unless The Anchor agrees otherwise in writing.</li>
                <li>Additional cleaning or rubbish removal caused by outside food may be charged to the Event Organiser and may be deducted from the booking and damage deposit.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Liability and reimbursement</h2>
              <ol class="sub">
                <li>The Event Organiser must reimburse The Anchor for direct and reasonably foreseeable losses, costs, claims, damages and expenses caused by outside food, external caterers or the Event Organiser&rsquo;s failure to comply with this agreement.</li>
                <li>Nothing in this agreement excludes or limits The Anchor&rsquo;s liability for death or personal injury caused by its negligence, fraud or fraudulent misrepresentation, breach of statutory duty, breach of statutory consumer rights that cannot lawfully be limited, or any other liability that cannot lawfully be excluded or restricted.</li>
                <li>This agreement does not make The Anchor responsible for outside food that it has not supplied, prepared, stored, heated, chilled or served.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Insurance</h2>
              <ol class="sub">
                <li>The Anchor&rsquo;s insurance does not provide cover for the Event Organiser&rsquo;s outside food arrangements. The Event Organiser and any external caterer should consider appropriate insurance.</li>
              </ol>
            </li>
            <li style="break-inside:avoid;">
              <h2 class="clause-h">Governing law</h2>
              <ol class="sub">
                <li>This agreement is governed by the laws of England and Wales. The courts of England and Wales have jurisdiction, subject to any mandatory consumer rights that apply.</li>
              </ol>
            </li>
          </ol>

          <p class="sign-intro" style="margin:4mm 0 3mm;">By signing below, the Event Organiser confirms agreement to the terms above. <b>This signature is separate from, and additional to, the signature on the private booking contract.</b></p>

          <div class="sign-grid">
            <div class="sign-card">
              <p class="sign-card-h">Event details</p>
              <p class="sign-card-sub">Completed by the Event Organiser</p>
              <div class="sf"><div class="sf-rule"><span class="sf-v">${eventDate}</span></div><span class="sf-cap">Event date</span></div>
              <div class="sf" style="margin-bottom:0;"><div class="sf-rule"><span class="sf-v">${waiverEventDetails}</span></div><span class="sf-cap">Event details</span></div>
            </div>
            <div class="sign-card">
              <p class="sign-card-h">Signed by the Event Organiser</p>
              <p class="sign-card-sub">Self-catering and outside food responsibility agreement</p>
              <div class="sf"><div class="sf-rule"><span class="sf-v">${safeCustomerName}</span></div><span class="sf-cap">Event organiser&rsquo;s name</span></div>
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
