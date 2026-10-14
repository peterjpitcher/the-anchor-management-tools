import { PDFDocument } from 'pdf-lib'
import { PdfSheetOverflowError } from '@/lib/pdf/sheet-overflow'
import { createPdfBrowser, generatePDFFromHTML } from '@/lib/pdf-generator'

/** The browser the PDF generator runs in, as createPdfBrowser hands it out. */
type PdfBrowser = Awaited<ReturnType<typeof createPdfBrowser>>
import type { SigningPartyRole } from './types'

/**
 * Rendering a document for signature, and rendering it again once it is signed.
 *
 * The HTML a document was rendered from is stored beside its PDF, with its signature slots
 * still marked (src/lib/signing/signature-slots.ts). This module turns that HTML into a PDF:
 * with the page geometry its template expects, and keeping only the pages that belong to this
 * document where one HTML holds two (the booking contract and its self-catering agreement are
 * one HTML and two separately signed documents).
 */

/** How a template expects to be printed. */
export type SigningPdfProfile =
  /** The template owns its A4 sheets (`@page` size, zero margins): contract, worker agreement. */
  | 'a4_css_page'
  /** Flowing text with the PDF generator's standard 15mm margins: template kinds. */
  | 'a4_margins'
  /** Flowing text with 8mm margins, as the quote PDF is printed. */
  | 'a4_compact'

const PDF_OPTIONS: Record<SigningPdfProfile, Record<string, unknown> | undefined> = {
  a4_css_page: {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  a4_margins: undefined,
  a4_compact: {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    displayHeaderFooter: false,
  },
}

/** Which pages of the rendered PDF make up this document. Omitted means all of them. */
export interface SigningPageSelection {
  /** Drop this many pages from the end (the contract, without the annex that follows it). */
  skipLast?: number
  /** Keep only this many pages from the end (the annex on its own). */
  onlyLast?: number
  /**
   * How many pages the whole render must have. Counting from the end is only right while the
   * layout is the one the split was worked out against, so a different total stops the render.
   */
  total?: number
}

/** What createSigningRequest is given so the signed copy can be rendered later. */
export interface SigningRenderInput {
  /** The document's HTML with its signature slots marked and unfilled. */
  html: string
  profile: SigningPdfProfile
  pages?: SigningPageSelection
  /** Which party fills which slot: slot key to party role. */
  slots: Record<string, SigningPartyRole>
  /** True when the template printed the initials marker in its footers. */
  hasInitials?: boolean
}

/** The same, as stored on the document (`signing_documents.context.render`). */
export interface SigningRenderSpec extends Omit<SigningRenderInput, 'html'> {
  htmlPath: string
  /** SHA-256 of the stored HTML. The signed copy is only ever rendered from a file that matches. */
  htmlSha256: string
}

const PROFILES: readonly SigningPdfProfile[] = ['a4_css_page', 'a4_margins', 'a4_compact']

/** The render did not come out with the pages the page selection was worked out against. */
export class SigningPageCountError extends Error {
  constructor(public readonly actual: number, public readonly expected: number) {
    super(`The document printed as ${actual} pages where ${expected} were expected, so its pages could not be divided safely`)
    this.name = 'SigningPageCountError'
  }
}

/** The pages asked for are not in the render at all. */
export class SigningPageRangeError extends Error {
  constructor(from: number, to: number, total: number) {
    super(`Cannot select pages ${from + 1} to ${to} of a ${total} page document`)
    this.name = 'SigningPageRangeError'
  }
}

/**
 * True for a render that completed but cannot be trusted to be the document as sent: a sheet
 * overflowed, or the page count moved. The signed copy then falls back to the file each signer
 * was shown, which is fingerprinted.
 */
export function isUntrustedRender(error: unknown): boolean {
  return (
    error instanceof PdfSheetOverflowError
    || error instanceof SigningPageCountError
    || error instanceof SigningPageRangeError
  )
}

/**
 * Read the render spec off a document, or null when it has none (a document sent before
 * signatures were shown in place has only its PDF, and keeps the plain signing record page).
 */
export function readSigningRenderSpec(context: Record<string, unknown> | null | undefined): SigningRenderSpec | null {
  const raw = context?.render
  if (!raw || typeof raw !== 'object') return null
  const spec = raw as Partial<SigningRenderSpec>
  if (typeof spec.htmlPath !== 'string' || !PROFILES.includes(spec.profile as SigningPdfProfile)) return null
  // No fingerprint, no second render: the signed copy falls back to the fingerprinted PDF.
  if (typeof spec.htmlSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(spec.htmlSha256)) return null
  if (!spec.slots || typeof spec.slots !== 'object') return null
  return {
    htmlPath: spec.htmlPath,
    htmlSha256: spec.htmlSha256,
    profile: spec.profile as SigningPdfProfile,
    pages: spec.pages,
    slots: spec.slots as Record<string, SigningPartyRole>,
    hasInitials: spec.hasInitials === true,
  }
}

export async function selectPdfPages(pdf: Buffer, pages: SigningPageSelection | undefined): Promise<Buffer> {
  const skipLast = pages?.skipLast ?? 0
  const onlyLast = pages?.onlyLast ?? 0
  const expectedTotal = pages?.total
  if (skipLast > 0 && onlyLast > 0) {
    throw new Error('A page selection can drop pages from the end or keep them, not both')
  }
  if (skipLast <= 0 && onlyLast <= 0 && expectedTotal == null) return pdf

  const source = await PDFDocument.load(pdf)
  const total = source.getPageCount()
  if (expectedTotal != null && total !== expectedTotal) {
    throw new SigningPageCountError(total, expectedTotal)
  }
  if (skipLast <= 0 && onlyLast <= 0) return pdf
  const from = onlyLast > 0 ? total - onlyLast : 0
  const to = onlyLast > 0 ? total : total - skipLast
  if (from < 0 || to <= from || to > total) {
    // A different page count from the one the split was worked out against means the layout
    // has moved. Cutting anyway would hand someone the wrong pages to sign.
    throw new SigningPageRangeError(from, to, total)
  }
  const selected = await PDFDocument.create()
  const copied = await selected.copyPages(source, Array.from({ length: to - from }, (_, index) => from + index))
  for (const page of copied) selected.addPage(page)
  return Buffer.from(await selected.save())
}

/** Render filled HTML to the PDF pages that make up one document. */
export async function renderSigningPdf(input: {
  /** HTML with every slot already filled. */
  html: string
  profile: SigningPdfProfile
  pages?: SigningPageSelection
  /** Reuse a browser the caller already started, when it has more than one PDF to make. */
  browser?: PdfBrowser
}): Promise<Buffer> {
  const pdf = await generatePDFFromHTML(input.html, PDF_OPTIONS[input.profile], {
    ...(input.browser ? { browser: input.browser } : {}),
    // Fixed A4 sheets hide whatever does not fit. A sheet that overflows stops the render, when
    // the document is sent and again when the signed copy is made.
    ...(input.profile === 'a4_css_page' ? { refuseClippedSheets: true } : {}),
  })
  return selectPdfPages(pdf, input.pages)
}

/** How many pages a rendered PDF has. Used to work out a split once, at send time. */
export async function countPdfPages(pdf: Buffer): Promise<number> {
  return (await PDFDocument.load(pdf)).getPageCount()
}
