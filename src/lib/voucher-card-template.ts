// Voucher card print template (spec section 6, F01/F04/F24).
//
// Reproduces docs/design/voucher-system/'Voucher Set (Folded Card, B&W Print).html'
// print path exactly: A4 landscape sheets (page box 296.6mm x 209.6mm, @page margin 0),
// two 148.5mm x 210mm panels per sheet with 12mm padding, folded to an A5 portrait
// card. Per card: page 1 outside = back cover (terms) left + front cover right,
// page 2 inside = prize left + details right. Cards are grouped by type, then
// card-by-card page pairs. Black ink only, no fold line.
//
// This is a standalone print document like contract-template.ts: it must not
// import app UI tokens. Fonts and artwork are embedded (no CDN dependency when
// VOUCHER_FONTS_SELF_HOSTED is true). Render through generatePDFFromHTML with
// { format: 'A4', landscape: true, preferCSSPageSize: true, printBackground: true,
// margin: { top: '0', right: '0', bottom: '0', left: '0' } }.
//
// Type copy (headlines, entitlement HTML, terms clauses) is controlled content
// from the batch snapshot / terms register, authored in the vendored handoff with
// HTML entities and markup, so it is inserted verbatim. Only system-generated
// values (voucher numbers, terms version) are escaped.

import type { TermsClause } from '@/types/vouchers'
import {
  VOUCHER_CARD_FONT_FACE_CSS,
  VOUCHER_CARD_FONT_LINKS_HTML,
} from '@/lib/vouchers/card-fonts'
import {
  ANCHOR_LOGO_BLACK_DATA_URI,
  QR_EVENTS_BOOKING_DATA_URI,
} from '@/lib/vouchers/card-assets'

export interface VoucherCardInput {
  voucherNumber: string
  typeId: string
}

export interface VoucherBatchHtmlParams {
  vouchers: VoucherCardInput[]
  typeDefinitions: Record<string, unknown>
  termsVersion: string
  termsClauses: TermsClause[]
}

export interface TermsSheetHtmlParams {
  version: string
  clauses: TermsClause[]
}

// Fixed card copy (handoff constants, never merge fields)
const PROMOTER = 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ'
const SIGN_OFF_HTML = '<b>Where everyone&rsquo;s welcome.</b><br>A village pub since 1751.'

interface CardHero {
  kind: string
  big: string
  sub: string
}

interface CardCopy {
  headline: string
  script: string
  prize: string
  open: string
  aside: string
  community: string
}

interface CardTypeDefinition {
  id: string
  displayTitle: string
  requiresBooking: boolean
  entitlementHtml: string
  hero: CardHero
  copy: CardCopy
  sortOrder: number
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readBoolean(record: Record<string, unknown>, snakeKey: string, camelKey: string): boolean | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'boolean' ? value : null
}

// Normalises one batch type_definitions entry (snake_case DB snapshot or
// camelCase domain shape) into the card fields, failing loudly rather than
// printing a card with missing copy (F04).
function normaliseTypeDefinition(typeId: string, raw: unknown): CardTypeDefinition {
  if (!isRecord(raw)) {
    throw new Error(`Voucher type definition missing for type ${typeId}`)
  }

  const displayTitle = readString(raw, 'display_title', 'displayTitle')
  const entitlementHtml = readString(raw, 'entitlement_html', 'entitlementHtml')
  const requiresBooking = readBoolean(raw, 'requires_booking', 'requiresBooking')
  const heroRaw = raw.hero
  const copyRaw = raw.copy

  if (!displayTitle || !entitlementHtml || requiresBooking === null) {
    throw new Error(`Voucher type definition for ${typeId} is missing required card fields`)
  }
  if (!isRecord(heroRaw) || !isRecord(copyRaw)) {
    throw new Error(`Voucher type definition for ${typeId} is missing hero or copy`)
  }

  const hero: CardHero = {
    kind: typeof heroRaw.kind === 'string' ? heroRaw.kind : '',
    big: typeof heroRaw.big === 'string' ? heroRaw.big : '',
    sub: typeof heroRaw.sub === 'string' ? heroRaw.sub : '',
  }
  if (!hero.kind || !hero.big || !hero.sub) {
    throw new Error(`Voucher type definition for ${typeId} has an incomplete hero`)
  }

  const copyKeys: Array<keyof CardCopy> = ['headline', 'script', 'prize', 'open', 'aside', 'community']
  const copyEntries = copyKeys.map(key => {
    const value = copyRaw[key]
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Voucher type definition for ${typeId} is missing copy.${key}`)
    }
    return [key, value] as const
  })
  const copy = Object.fromEntries(copyEntries) as unknown as CardCopy

  const sortOrderRaw = raw.sort_order ?? raw.sortOrder
  const sortOrder = typeof sortOrderRaw === 'number' ? sortOrderRaw : Number.MAX_SAFE_INTEGER

  return { id: typeId, displayTitle, requiresBooking, entitlementHtml, hero, copy, sortOrder }
}

// The handoff card CSS, print path only (screen-only spec/stage/label rules
// removed, print sizes baked in). Every measurement matches the handoff.
function cardStylesheet(): string {
  return `${VOUCHER_CARD_FONT_FACE_CSS}
:root{--paper:#fff;--ink:#161616;--ink-soft:#363636;--ink-mute:#6b6b6b;--rule:#cfcfcf;--pad:12mm;--font-display:'DM Serif Display',Georgia,serif;--font-body:'Outfit',system-ui,-apple-system,sans-serif;--font-script:'Clicker Script',cursive}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:var(--font-body);color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4 landscape;margin:0}
.page{width:296.6mm;height:209.6mm;background:var(--paper);position:relative;display:flex;overflow:hidden;page-break-inside:avoid;break-inside:avoid;page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.panel{width:148.5mm;height:210mm;padding:var(--pad);position:relative;display:flex;flex-direction:column;overflow:hidden}
.panel-inner{display:flex;flex-direction:column;height:100%;position:relative;z-index:2}
.kick{font-weight:600;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-mute);margin:0}
.cover::after{content:"";position:absolute;inset:7mm;border:1px solid var(--ink);pointer-events:none;z-index:1}
.cover .panel-inner{align-items:center;justify-content:space-between;text-align:center}
.cv-logo{width:48mm;height:auto;display:block;margin:4mm auto 4.5mm}
.cv-mid{display:flex;flex-direction:column;justify-content:center;flex:1;padding:2mm 0}
.cv-title{font-family:var(--font-display);font-weight:400;font-size:52px;line-height:.94;letter-spacing:-.03em;color:var(--ink);margin:0 auto;max-width:112mm;text-wrap:balance}
.cv-script{font-family:var(--font-script);font-size:34px;color:var(--ink-soft);line-height:1;margin:5mm 0 0}
.cv-rule{width:26mm;height:1px;background:var(--ink);margin:8mm auto}
.cv-prize{font-family:var(--font-display);font-weight:400;font-size:27px;line-height:1.08;letter-spacing:-.01em;color:var(--ink);margin:0 auto;max-width:104mm;text-wrap:balance}
.cv-open{font-weight:600;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-mute);margin:0 0 3mm}
.prize{text-align:center}
.pz-body{flex:1;display:flex;flex-direction:column;justify-content:center}
.pz-fig{font-family:var(--font-display);font-weight:400;font-size:128px;line-height:.8;letter-spacing:-.04em;color:var(--ink);margin:0}
.pz-fig sup{font-size:54px;vertical-align:top;position:relative;top:14px;letter-spacing:0}
.pz-word{font-family:var(--font-display);font-weight:400;font-size:52px;line-height:.98;letter-spacing:-.025em;color:var(--ink);margin:0}
.pz-sub{font-family:var(--font-display);font-weight:400;font-size:32px;line-height:1.05;letter-spacing:-.01em;color:var(--ink);margin:5mm 0 0}
.pz-rule{width:100%;height:1px;background:var(--ink);margin:7mm 0}
.pz-aside{font-family:var(--font-script);font-size:27px;line-height:1.2;color:var(--ink-soft);margin:6mm auto 0;max-width:98mm;text-wrap:balance}
.pz-ent{font-size:12.5px;line-height:1.55;color:var(--ink-soft);margin:0 auto;max-width:104mm;text-align:left}
.pz-ent p{margin:0 0 2.6mm}
.pz-ent p:last-child{margin-bottom:0}
.pz-ent ul{margin:0 0 2.6mm;padding:0;list-style:none;display:flex;flex-direction:column;gap:1.4mm}
.pz-ent li{padding-left:4.4mm;position:relative}
.pz-ent li::before{content:"";position:absolute;left:0;top:2.2mm;width:2.4mm;height:1px;background:var(--ink)}
.pz-foot{margin-top:auto;padding-top:4mm;border-top:1px solid var(--rule);font-size:11.5px;line-height:1.5;color:var(--ink-mute)}
.pz-foot b{color:var(--ink);font-weight:600}
.pz-comm{font-weight:600;font-size:12.5px;line-height:1.4;color:var(--ink);margin:0 0 1.8mm}
.pz-sign{margin:0}
.det-head{padding-bottom:3.4mm;margin-bottom:6mm;border-bottom:1.4px solid var(--ink);flex-shrink:0}
.det-title{font-family:var(--font-display);font-weight:400;font-size:30px;line-height:1;letter-spacing:-.02em;color:var(--ink);margin:1.6mm 0 0}
.det-body{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0}
.fields{display:grid;grid-template-columns:1fr 1fr;gap:7mm 8mm;flex-shrink:0}
.field{min-width:0}
.field--wide{grid-column:1/-1}
.field-lab{font-weight:600;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-mute);margin:0 0 1.6mm}
.field-val{font-weight:600;font-size:15px;line-height:1.2;color:var(--ink);margin:0 0 1.8mm;letter-spacing:.02em}
.field-val.ref{font-size:19px;letter-spacing:.1em}
.field-write{height:9mm}
.field-line{height:1px;background:var(--ink);opacity:.55}
.present{border:1px solid var(--ink);padding:5.4mm;margin-top:9mm}
.present + .present{margin-top:4mm}
.present-h{font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-mute);margin:0 0 2.4mm}
.present-p{font-size:13.5px;line-height:1.5;color:var(--ink-soft);margin:0}
.present-p b{color:var(--ink);font-weight:600}
.det-foot{margin-top:auto;padding-top:3.6mm;border-top:1.4px solid var(--ink);display:flex;align-items:center;justify-content:space-between;gap:4.4mm}
.det-qr{width:20mm;height:20mm;display:block;flex-shrink:0}
.det-foot .qr-h{font-weight:600;font-size:11px;letter-spacing:.02em;color:var(--ink);margin:0 0 .8mm}
.det-foot p{margin:0;font-size:11px;line-height:1.5;color:var(--ink-mute)}
.det-foot b{color:var(--ink);font-weight:600}
.det-foot .ver{text-align:right;white-space:nowrap;font-size:10px}
.terms-head{padding-bottom:2.6mm;margin-bottom:3.6mm;border-bottom:1.4px solid var(--ink);flex-shrink:0}
.terms-title{font-family:var(--font-display);font-weight:400;font-size:23px;line-height:1;letter-spacing:-.02em;color:var(--ink);margin:1.2mm 0 0}
.terms{margin:0;padding:0;list-style:none;counter-reset:t;columns:2;column-gap:6mm;column-rule:1px solid var(--rule);flex:1}
.terms li{counter-increment:t;position:relative;padding-left:4.6mm;margin-bottom:1.7mm;font-size:8.6px;line-height:1.38;color:var(--ink-soft);break-inside:avoid}
.terms li::before{content:counter(t);position:absolute;left:0;top:0;font-weight:600;font-size:8.6px;color:var(--ink-mute)}
.terms b{font-weight:600;color:var(--ink)}
.terms-foot{margin-top:3.4mm;padding-top:3mm;border-top:1.4px solid var(--ink);display:flex;align-items:flex-end;justify-content:space-between;gap:5mm;flex-shrink:0}
.terms-foot p{margin:0;font-size:10.5px;line-height:1.5;color:var(--ink-mute)}
.terms-foot b{color:var(--ink);font-weight:600}
.terms-foot .ver{text-align:right;white-space:nowrap;font-size:10px}`
}

// Clause bodies and headings come from the terms register and carry the
// handoff's HTML entities, so they are inserted verbatim (matching the
// handoff's termsHTML builder).
function termsListHtml(clauses: TermsClause[]): string {
  return clauses.map(clause => `<li><b>${clause.heading}.</b> ${clause.body}</li>`).join('')
}

function heroHtml(hero: CardHero): string {
  if (hero.kind === 'money') {
    return `<p class="pz-fig"><sup>&pound;</sup>${hero.big}</p><p class="pz-sub">${hero.sub}</p>`
  }
  return `<p class="pz-word">${hero.big}</p><p class="pz-sub">${hero.sub}</p>`
}

interface CardPagesParams {
  definition: CardTypeDefinition
  voucherNumber: string
  termsVersion: string
  termsHtml: string
  cardIndex: number
}

// Page 1 of the card: outside sheet, back cover (terms) left + front cover right.
function outsidePageHtml(params: CardPagesParams): string {
  const { definition, voucherNumber, termsVersion, termsHtml, cardIndex } = params
  const safeNumber = escapeHtml(voucherNumber)
  const safeVersion = escapeHtml(termsVersion)
  return `<div class="page" data-voucher="${escapeHtml(definition.id)}" data-card="${cardIndex}" data-side="outside">
<div class="panel">
<div class="panel-inner">
<div class="terms-head"><p class="kick" data-field="displayTitle">${definition.displayTitle}</p><h2 class="terms-title">Terms and conditions</h2></div>
<ol class="terms">${termsHtml}</ol>
<div class="terms-foot"><p><b>The Anchor</b>, Horton Road<br>Stanwell Moor Village, Surrey, TW19 6AQ</p>
<p class="ver"><b>Voucher no.</b> <span data-field="voucherNumber">${safeNumber}</span><br>Terms <span data-field="termsVersion">${safeVersion}</span></p></div>
</div></div>
<div class="panel cover">
<div class="panel-inner">
<div><img class="cv-logo" src="${ANCHOR_LOGO_BLACK_DATA_URI}" alt="The Anchor"><p class="kick">Prize voucher &middot; Stanwell Moor Village</p></div>
<div class="cv-mid"><h1 class="cv-title" data-field="coverHeadline">${definition.copy.headline}</h1><p class="cv-script" data-field="coverScript">${definition.copy.script}</p><div class="cv-rule"></div>
<p class="cv-prize" data-field="coverPrize">${definition.copy.prize}</p></div>
<p class="cv-open" data-field="openLine">${definition.copy.open}</p>
</div></div>
</div>`
}

// Page 2 of the card: inside sheet, prize left + details right. Expiry, won at
// and issued by are hand-written at issue, so they print as ruled blanks with
// the data-field hooks kept on the blanks (handoff merge-field table).
function insidePageHtml(params: CardPagesParams): string {
  const { definition, voucherNumber, cardIndex } = params
  const safeNumber = escapeHtml(voucherNumber)
  const bookingBox = definition.requiresBooking
    ? '<div class="present"><p class="present-h">Booking required</p><p class="present-p">This voucher needs an advance booking and is subject to availability. <b>Please book with us before your visit.</b></p></div>'
    : ''
  return `<div class="page" data-voucher="${escapeHtml(definition.id)}" data-card="${cardIndex}" data-side="inside">
<div class="panel prize">
<div class="panel-inner">
<p class="kick">Your prize</p>
<div class="pz-body">${heroHtml(definition.hero)}<p class="pz-aside" data-field="insideAside">${definition.copy.aside}</p><div class="pz-rule"></div>
<div class="pz-ent" data-field="entitlement">${definition.entitlementHtml}</div></div>
<div class="pz-foot"><p class="pz-comm" data-field="communityLine">${definition.copy.community}</p>
<p class="pz-sign">${SIGN_OFF_HTML}</p></div>
</div></div>
<div class="panel">
<div class="panel-inner">
<div class="det-head"><p class="kick">Your voucher</p><h2 class="det-title">The details</h2></div>
<div class="det-body">
<div class="fields">
<div class="field field--wide"><p class="field-lab">Voucher number</p><p class="field-val ref" data-field="voucherNumber">${safeNumber}</p><div class="field-line"></div></div>
<div class="field"><p class="field-lab">Expiry date</p><div class="field-write" data-field="expiryDate"></div><div class="field-line"></div></div>
<div class="field"><p class="field-lab">Issued by</p><div class="field-write" data-field="issuedBy"></div><div class="field-line"></div></div>
<div class="field field--wide"><p class="field-lab">Won at (event and date)</p><div class="field-write" data-field="wonAt"></div><div class="field-line"></div></div>
</div>
<div class="present"><p class="present-h">Before you order</p><p class="present-p">Please present this voucher to a member of our team <b>before ordering, paying or booking.</b></p></div>
${bookingBox}
</div>
<div class="det-foot">
<img class="det-qr" src="${QR_EVENTS_BOOKING_DATA_URI}" alt="Scan to see what is on and to book">
<div><p class="qr-h">Scan for what&rsquo;s on, and to book</p>
<p><b>Full terms on the back.</b> ${PROMOTER}</p></div>
</div>
</div></div>
</div>`
}

// Builds the full batch print document. Cards are grouped by type (snapshot
// sort_order, then first appearance), and each card contributes an adjacent
// outside/inside page pair, so 1 card = 1 A4 sheet = 2 PDF pages (F01).
export function buildVoucherBatchHtml(params: VoucherBatchHtmlParams): string {
  const { vouchers, typeDefinitions, termsVersion, termsClauses } = params

  if (vouchers.length === 0) {
    throw new Error('Cannot build a voucher batch document with no vouchers')
  }
  if (termsClauses.length === 0) {
    throw new Error('Cannot build a voucher batch document with no terms clauses')
  }

  const definitions = new Map<string, CardTypeDefinition>()
  for (const voucher of vouchers) {
    if (!definitions.has(voucher.typeId)) {
      definitions.set(voucher.typeId, normaliseTypeDefinition(voucher.typeId, typeDefinitions[voucher.typeId]))
    }
  }

  const firstAppearance = new Map<string, number>()
  vouchers.forEach((voucher, index) => {
    if (!firstAppearance.has(voucher.typeId)) {
      firstAppearance.set(voucher.typeId, index)
    }
  })

  const orderedTypeIds = Array.from(definitions.keys()).sort((a, b) => {
    const bySortOrder = (definitions.get(a) as CardTypeDefinition).sortOrder - (definitions.get(b) as CardTypeDefinition).sortOrder
    if (bySortOrder !== 0) return bySortOrder
    return (firstAppearance.get(a) as number) - (firstAppearance.get(b) as number)
  })

  const termsHtml = termsListHtml(termsClauses)
  const pages: string[] = []
  let cardIndex = 0

  for (const typeId of orderedTypeIds) {
    const definition = definitions.get(typeId) as CardTypeDefinition
    for (const voucher of vouchers) {
      if (voucher.typeId !== typeId) continue
      cardIndex += 1
      const cardParams: CardPagesParams = {
        definition,
        voucherNumber: voucher.voucherNumber,
        termsVersion,
        termsHtml,
        cardIndex,
      }
      pages.push(outsidePageHtml(cardParams))
      pages.push(insidePageHtml(cardParams))
    }
  }

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<title>The Anchor voucher batch (${escapeHtml(termsVersion)})</title>
${VOUCHER_CARD_FONT_LINKS_HTML}<style>
${cardStylesheet()}
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`
}

// Builds the standalone printable terms sheet (spec F47): a clean A4 portrait
// document of the full clause list at readable size. Rendered through
// generatePDFFromHTML defaults (A4 portrait, 15mm margins); content flows to
// further pages when needed.
export function buildTermsSheetHtml(params: TermsSheetHtmlParams): string {
  const { version, clauses } = params

  if (clauses.length === 0) {
    throw new Error('Cannot build a terms sheet with no clauses')
  }

  const safeVersion = escapeHtml(version)
  const clausesHtml = clauses
    .map(clause => `<li><h2>${clause.heading}</h2><p>${clause.body}</p></li>`)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<title>The Anchor - Voucher terms (${safeVersion})</title>
${VOUCHER_CARD_FONT_LINKS_HTML}<style>
${VOUCHER_CARD_FONT_FACE_CSS}
:root{--ink:#161616;--ink-soft:#363636;--ink-mute:#6b6b6b;--rule:#cfcfcf;--font-display:'DM Serif Display',Georgia,serif;--font-body:'Outfit',system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:var(--font-body);color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet-head{padding-bottom:5mm;margin-bottom:6mm;border-bottom:1.4px solid var(--ink)}
.sheet-kicker{font-weight:600;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-mute);margin:0 0 2mm}
.sheet-title{font-family:var(--font-display);font-weight:400;font-size:26px;line-height:1.05;letter-spacing:-.02em;color:var(--ink);margin:0}
.sheet-meta{font-size:10.5pt;line-height:1.5;color:var(--ink-mute);margin:2.4mm 0 0}
.sheet-meta b{color:var(--ink);font-weight:600}
.terms-list{margin:0;padding:0 0 0 6mm;counter-reset:none}
.terms-list li{margin:0 0 3.2mm;break-inside:avoid;padding-left:1.4mm}
.terms-list h2{font-family:var(--font-body);font-weight:600;font-size:10.5pt;line-height:1.4;color:var(--ink);margin:0}
.terms-list p{font-size:10.5pt;line-height:1.5;color:var(--ink-soft);margin:.6mm 0 0}
.sheet-foot{margin-top:7mm;padding-top:3.6mm;border-top:1px solid var(--rule);font-size:9.5pt;line-height:1.5;color:var(--ink-mute)}
.sheet-foot b{color:var(--ink);font-weight:600}
</style>
</head>
<body>
<header class="sheet-head">
<p class="sheet-kicker">Prize voucher &middot; Stanwell Moor Village</p>
<h1 class="sheet-title">The Anchor - Voucher terms (${safeVersion})</h1>
<p class="sheet-meta"><b>The Anchor</b>, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ</p>
</header>
<ol class="terms-list" data-terms-version="${safeVersion}">
${clausesHtml}
</ol>
<footer class="sheet-foot">
<p>These terms apply to prize and promotional vouchers issued by <b>The Anchor</b>. The version in force when a voucher is issued applies to that voucher; the version number is printed on the back cover of the card.</p>
</footer>
</body>
</html>`
}
