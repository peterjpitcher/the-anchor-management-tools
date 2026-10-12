import { GUEST, STAFF } from '@/lib/brand/palette'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { getAnchorLogoDataUri } from '@/lib/pdf/anchor-logo'
import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'
import type { SigningBrand } from './types'

import { escapeHtml, templateBodyToHtml } from './template-text'

// The text functions live in template-text.ts, which is safe to import in the browser. They are
// re-exported here so server code has one place to import templates from.
export {
  DRAFT_MARKER_PATTERN,
  TemplateMergeError,
  escapeHtml,
  findDraftMarkers,
  findMergeFields,
  mergeTemplateText,
  templateBodyToHtml,
} from './template-text'

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
