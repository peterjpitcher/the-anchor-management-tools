import { GUEST, STAFF } from '@/lib/brand/palette'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { getAnchorLogoDataUri } from '@/lib/pdf/anchor-logo'
import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'
import type { SigningBrand } from './types'

/**
 * Template wording is plain text with three markers, so the owner can edit it in a text box
 * without learning anything:
 *
 *   ## A heading
 *   - a bullet
 *   {{merge_field}}
 *
 * A blank line starts a new paragraph. Everything else is printed exactly as typed, escaped.
 *
 * `[[TO CONFIRM: ...]]` marks a gap the owner must fill before the template can be switched on.
 */

export const DRAFT_MARKER_PATTERN = /\[\[[^\]]*\]\]/g
const MERGE_FIELD_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/g

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** The gaps still marked in a template, so the settings page can list them and refuse to activate. */
export function findDraftMarkers(body: string): string[] {
  return body.match(DRAFT_MARKER_PATTERN) ?? []
}

/** The merge fields a template uses, in the order they first appear. */
export function findMergeFields(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(MERGE_FIELD_PATTERN)) {
    seen.add(match[1])
  }
  return [...seen]
}

export class TemplateMergeError extends Error {
  constructor(public readonly missingFields: string[]) {
    super(`Template needs values that were not supplied: ${missingFields.join(', ')}`)
    this.name = 'TemplateMergeError'
  }
}

/**
 * Fill the merge fields. A field with no value is an error, never a blank: a contract that
 * reaches someone with a gap where the pay rate should be is worse than one that is not sent.
 */
export function mergeTemplateText(text: string, values: Record<string, string | null | undefined>): string {
  const missing = findMergeFields(text).filter((field) => {
    const value = values[field]
    return value === null || value === undefined || String(value).trim() === ''
  })
  if (missing.length > 0) {
    throw new TemplateMergeError(missing)
  }
  return text.replace(MERGE_FIELD_PATTERN, (_match, field: string) => String(values[field]).trim())
}

/** Turn merged template text into body HTML. All text is escaped; only our own tags are emitted. */
export function templateBodyToHtml(mergedBody: string): string {
  const lines = mergedBody.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let bullets: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.map(escapeHtml).join('<br>')}</p>`)
      paragraph = []
    }
  }
  const flushBullets = (): void => {
    if (bullets.length > 0) {
      html.push(`<ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`)
      bullets = []
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushParagraph()
      flushBullets()
      continue
    }
    if (line.startsWith('## ')) {
      flushParagraph()
      flushBullets()
      html.push(`<h2>${escapeHtml(line.slice(3).trim())}</h2>`)
      continue
    }
    if (line.startsWith('- ')) {
      flushParagraph()
      bullets.push(line.slice(2).trim())
      continue
    }
    flushBullets()
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushBullets()

  return html.join('\n')
}

export interface TemplateDocumentInput {
  brand: SigningBrand
  title: string
  /** Short line under the title, such as "Prepared for Sam Example on 12 October 2026". */
  subtitle?: string | null
  /** Already merged template text. */
  mergedBody: string
  /** Printed small in the footer so a printed copy can be matched to its record. */
  reference: string
}

/**
 * A complete A4 HTML document for a template kind, ready for generatePDFFromHTML. System fonts
 * only, so rendering never waits on a font download, and flowing text with no fixed-height
 * pages, so long wording simply runs on to the next page.
 */
export function renderTemplateDocumentHtml(input: TemplateDocumentInput): string {
  const isGuest = input.brand === 'guest'
  const palette = isGuest
    ? { text: GUEST.text, muted: GUEST.textMuted, accent: GUEST.green, border: GUEST.border }
    : { text: STAFF.text, muted: STAFF.textMuted, accent: STAFF.primary, border: STAFF.border }
  const logo = isGuest ? getAnchorLogoDataUri() : getDocumentLogoDataUri()
  const businessName = isGuest
    ? `${COMPANY_DETAILS.legalName} trading as ${COMPANY_DETAILS.tradingName}`
    : COMPANY_DETAILS.legalName

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(input.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.5; color: ${palette.text}; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; margin-bottom: 22px; border-bottom: 2px solid ${palette.accent}; }
  .head img { max-width: 160px; max-height: 60px; }
  .business { text-align: right; font-size: 9pt; color: ${palette.muted}; line-height: 1.4; }
  h1 { font-size: 18pt; line-height: 1.25; margin: 0 0 4px; color: ${palette.text}; }
  .subtitle { margin: 0 0 20px; color: ${palette.muted}; font-size: 10pt; }
  h2 { font-size: 12pt; margin: 20px 0 6px; color: ${palette.accent}; break-after: avoid; }
  p { margin: 0 0 10px; }
  ul { margin: 0 0 10px; padding-left: 20px; }
  li { margin-bottom: 4px; }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid ${palette.border}; font-size: 8pt; color: ${palette.muted}; break-inside: avoid; }
</style>
</head>
<body>
  <div class="head">
    <div>${logo ? `<img src="${logo}" alt="${escapeHtml(businessName)}">` : `<strong>${escapeHtml(businessName)}</strong>`}</div>
    <div class="business">
      ${escapeHtml(businessName)}<br>
      ${escapeHtml(COMPANY_DETAILS.fullAddress)}<br>
      Company number ${escapeHtml(COMPANY_DETAILS.companyNumber)}
    </div>
  </div>
  <h1>${escapeHtml(input.title)}</h1>
  ${input.subtitle ? `<p class="subtitle">${escapeHtml(input.subtitle)}</p>` : ''}
  ${templateBodyToHtml(input.mergedBody)}
  <div class="foot">
    ${escapeHtml(businessName)} | Reference ${escapeHtml(input.reference)}<br>
    This document is signed electronically. The signing record is attached as its last page.
  </div>
</body>
</html>`
}
