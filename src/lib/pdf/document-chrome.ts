/**
 * The furniture every customer financial document shares: page geometry, base
 * typography, the logo and company header, and the legal footer.
 *
 * Invoice, quote and statement each carried their own copy. Copies drift, and
 * this pair has drifted twice already: the quote printed the logo at 150px
 * against the invoice's 90px (fixed in 41b4c8a1), and carried a different
 * contact mobile (fixed in 1288a5e0). Both were found by accident rather than by
 * a test.
 *
 * The CSS below is the invoice's, verbatim, including its whitespace. Invoice
 * and quote were byte-identical here once the two per-document selectors are
 * set aside, which is what makes this extraction provably output-neutral rather
 * than merely visually similar.
 *
 * Deliberately narrow. This owns only what is genuinely common; per-document
 * body CSS stays with each template. The stylesheet is emitted in three parts
 * because the templates put `.footer` AFTER their body rules, and preserving
 * that order is what keeps the generated HTML unchanged.
 */

import { COMPANY_DETAILS } from '@/lib/company-details'

/** One place for the cap, so two templates cannot disagree about it again. */
export const LOGO_MAX_WIDTH_PX = 90

const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07990587315'

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export interface DocumentHeadOptions {
  /** Already-escaped title markup, because each template composes it differently. */
  titleHtml: string
  /** The right-hand meta block's selector, with the dot. `.invoice-header` and friends. */
  metaClass: string
  /** The document-number line's selector, with the dot. */
  numberClass: string
  /** This document's own body CSS, emitted verbatim between the shared rules. */
  bodyCss: string
}

/** Everything from the doctype to the closing `</head>`, stylesheet included. */
export function renderDocumentHead(options: DocumentHeadOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.titleHtml}</title>
  <style>
    @page {
      size: A4;
      margin: 8mm;
    }
    
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      .keep-together { page-break-inside: avoid; }
    }
    
    body {
      font-family: Arial, sans-serif;
      line-height: 1.3;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 5px;
      font-size: 8pt;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 8px;
    }
    
    .logo-section {
      flex: 1;
    }
    
    .logo {
      max-width: 90px;
      height: auto;
      margin-bottom: 5px;
    }
    
    ${options.metaClass} {
      flex: 1;
      text-align: right;
    }
    
    h1 {
      color: #111827;
      margin: 0 0 5px 0;
      font-size: 16pt;
      font-weight: 700;
    }
    
    ${options.numberClass} {
      font-size: 10pt;
      color: #6b7280;
      margin-bottom: 2px;
    }
    
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 8pt;
      font-weight: 600;
      color: white;
      margin-top: 5px;
    }
    
    .company-details {
      margin-bottom: 10px;
      font-size: 8pt;
      color: #6b7280;
    }
    
${options.bodyCss}    .footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 7pt;
    }
    
    .footer p {
      margin: 2px 0;
    }
  </style>
</head>`
}

export interface DocumentHeaderOptions {
  /** Absolute URL or data URI. Omitted entirely when absent, as the templates already do. */
  logoUrl?: string
  /** Matches the head's metaClass, without the leading dot. */
  metaClass: string
  /** Already-escaped heading markup. */
  headingHtml: string
  /**
   * The right-hand meta block's inner markup, below the heading. Explicitly
   * trusted, because the invoice puts a coloured status badge here. Callers
   * escape their own values; never pass client-controlled text straight in.
   */
  metaHtml: string
}

export function renderDocumentHeader(options: DocumentHeaderOptions): string {
  return `  <div class="header">
    <div class="logo-section">
      ${options.logoUrl ? `<img src="${options.logoUrl}" alt="${COMPANY_DETAILS.name}" class="logo">` : ''}
      <div class="company-details">
        <strong>${COMPANY_DETAILS.name}</strong><br>
        ${COMPANY_DETAILS.fullAddress}<br>
        VAT: ${COMPANY_DETAILS.vatNumber}
      </div>
    </div>
    <div class="${options.metaClass}">
      <h1>${options.headingHtml}</h1>
${options.metaHtml}
    </div>
  </div>`
}

/**
 * The legal footer. Company identity comes from `COMPANY_DETAILS`; contact name
 * and mobile come from the environment, which is where they already lived.
 */
export function renderDocumentFooter(): string {
  return `  <div class="footer">
    <p>${COMPANY_DETAILS.name} | Company Reg: ${COMPANY_DETAILS.companyNumber} | VAT: ${COMPANY_DETAILS.vatNumber}</p>
    <p>${COMPANY_DETAILS.fullAddress} | ${COMPANY_DETAILS.phone} | ${COMPANY_DETAILS.email}</p>
    <p>Contact: ${escapeHtml(CONTACT_NAME)} | Mobile: ${escapeHtml(CONTACT_PHONE)}</p>
  </div>`
}
