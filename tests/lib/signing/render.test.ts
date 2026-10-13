// @vitest-environment node
// Server code: Buffers and pdf-lib must share one set of typed-array classes, which jsdom splits.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

const state = vi.hoisted(() => ({
  generatePdf: vi.fn<(...args: unknown[]) => Promise<Buffer>>(),
}))

// The real generator starts a browser. Nothing here may do that.
vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: (...args: unknown[]) => state.generatePdf(...args),
  createPdfBrowser: async () => {
    throw new Error('A test must never start a browser')
  },
  closePdfBrowser: async () => undefined,
}))

import {
  countPdfPages,
  readSigningRenderSpec,
  renderSigningPdf,
  selectPdfPages,
  type SigningPdfProfile,
} from '@/lib/signing/render'

type RenderInput = Parameters<typeof renderSigningPdf>[0]

/** A PDF whose pages are squares of the sizes given, so each page can be told apart by its size. */
async function pdfWithPages(sizes: number[]): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  for (const size of sizes) pdf.addPage([size, size])
  return Buffer.from(await pdf.save())
}

/** The size of each page, in order: which pages a PDF holds. */
async function pagesOf(pdf: Buffer): Promise<number[]> {
  const loaded = await PDFDocument.load(pdf)
  return loaded.getPages().map((page) => Math.round(page.getWidth()))
}

beforeEach(() => {
  state.generatePdf.mockReset()
})

describe('choosing which pages of a rendered PDF make up a document', () => {
  it('hands back the very same file when no pages are chosen', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    expect(await selectPdfPages(pdf, undefined)).toBe(pdf)
    expect(await selectPdfPages(pdf, {})).toBe(pdf)
    expect(await selectPdfPages(pdf, { skipLast: 0 })).toBe(pdf)
    expect(await selectPdfPages(pdf, { onlyLast: 0 })).toBe(pdf)
    expect(await selectPdfPages(pdf, { skipLast: 0, onlyLast: 0 })).toBe(pdf)
  })

  it('drops pages from the end, keeping the ones before them in order', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    expect(await pagesOf(await selectPdfPages(pdf, { skipLast: 1 }))).toEqual([100, 200])
    expect(await pagesOf(await selectPdfPages(pdf, { skipLast: 2 }))).toEqual([100])
  })

  it('keeps only pages from the end, in order', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    expect(await pagesOf(await selectPdfPages(pdf, { onlyLast: 1 }))).toEqual([300])
    expect(await pagesOf(await selectPdfPages(pdf, { onlyLast: 2 }))).toEqual([200, 300])
    expect(await pagesOf(await selectPdfPages(pdf, { onlyLast: 3 }))).toEqual([100, 200, 300])
  })

  it('splits a contract and its annex so every page lands in exactly one of them', async () => {
    const pdf = await pdfWithPages([100, 200, 300, 400, 500])

    const contract = await pagesOf(await selectPdfPages(pdf, { skipLast: 1 }))
    const annex = await pagesOf(await selectPdfPages(pdf, { onlyLast: 1 }))

    expect(contract).toEqual([100, 200, 300, 400])
    expect(annex).toEqual([500])
    expect([...contract, ...annex]).toEqual(await pagesOf(pdf))
  })

  it('leaves the file it was given untouched', async () => {
    const pdf = await pdfWithPages([100, 200, 300])
    const before = Buffer.from(pdf)

    const selected = await selectPdfPages(pdf, { onlyLast: 1 })

    expect(selected).not.toBe(pdf)
    expect(pdf.equals(before)).toBe(true)
    expect(await pagesOf(pdf)).toEqual([100, 200, 300])
  })

  it('refuses to drop every page, or more pages than there are', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    await expect(selectPdfPages(pdf, { skipLast: 3 })).rejects.toThrow(/Cannot select pages .* of a 3 page document/)
    await expect(selectPdfPages(pdf, { skipLast: 4 })).rejects.toThrow(/Cannot select pages .* of a 3 page document/)
    await expect(selectPdfPages(await pdfWithPages([100]), { skipLast: 1 })).rejects.toThrow(/of a 1 page document/)
  })

  it('refuses to keep more pages from the end than there are', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    await expect(selectPdfPages(pdf, { onlyLast: 4 })).rejects.toThrow(/Cannot select pages .* of a 3 page document/)
    await expect(selectPdfPages(await pdfWithPages([100]), { onlyLast: 2 })).rejects.toThrow(/of a 1 page document/)
  })

  it('does not even open the file when there is no selection at all', async () => {
    // Bytes that are not a PDF would fail to load, so getting them back proves nothing was read.
    const notAPdf = Buffer.from('this is not a PDF')

    expect(await selectPdfPages(notAPdf, undefined)).toBe(notAPdf)
    expect(await selectPdfPages(notAPdf, {})).toBe(notAPdf)
    expect(await selectPdfPages(notAPdf, { skipLast: 0, onlyLast: 0 })).toBe(notAPdf)
  })
})

describe('a page selection that contradicts itself', () => {
  it('is refused, because it cannot both drop pages from the end and keep only those pages', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    await expect(selectPdfPages(pdf, { skipLast: 1, onlyLast: 1 })).rejects.toThrow(/not both/)
  })
})

describe('holding a page selection to the page count it was worked out for', () => {
  it('divides the pages as usual when the render has the expected number of pages', async () => {
    const pdf = await pdfWithPages([100, 200, 300, 400, 500])

    expect(await pagesOf(await selectPdfPages(pdf, { skipLast: 1, total: 5 }))).toEqual([100, 200, 300, 400])
    expect(await pagesOf(await selectPdfPages(pdf, { onlyLast: 1, total: 5 }))).toEqual([500])
  })

  it('stops when the render is longer than expected, so the contract cannot swallow the first annex page', async () => {
    // Worked out for four contract sheets and one annex sheet. One sheet has spilled on to a
    // sixth page, so counting one page from the end would no longer find the annex.
    const pdf = await pdfWithPages([100, 200, 300, 400, 500, 600])

    await expect(selectPdfPages(pdf, { skipLast: 1, total: 5 })).rejects.toThrow(/6 pages where 5 were expected/)
    await expect(selectPdfPages(pdf, { onlyLast: 1, total: 5 })).rejects.toThrow(/6 pages where 5 were expected/)
  })

  it('stops when the render is shorter than expected', async () => {
    const pdf = await pdfWithPages([100, 200, 300, 400])

    await expect(selectPdfPages(pdf, { skipLast: 1, total: 5 })).rejects.toThrow(/4 pages where 5 were expected/)
    await expect(selectPdfPages(pdf, { onlyLast: 1, total: 5 })).rejects.toThrow(/4 pages where 5 were expected/)
  })

  it('checks the count and hands back the very same file when every page is kept', async () => {
    const pdf = await pdfWithPages([100, 200, 300])
    const before = Buffer.from(pdf)

    const checked = await selectPdfPages(pdf, { total: 3 })

    expect(checked).toBe(pdf)
    expect(pdf.equals(before)).toBe(true)
    expect(await selectPdfPages(pdf, { total: 3, skipLast: 0, onlyLast: 0 })).toBe(pdf)
  })

  it('stops when every page is kept but the count is not the one expected', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    await expect(selectPdfPages(pdf, { total: 4 })).rejects.toThrow(/3 pages where 4 were expected/)
    await expect(selectPdfPages(pdf, { total: 2 })).rejects.toThrow(/3 pages where 2 were expected/)
  })

  it('opens the file to count it once an expected count is given', async () => {
    await expect(selectPdfPages(Buffer.from('this is not a PDF'), { total: 1 })).rejects.toThrow()
  })

  it('reports the wrong page count before anything about the selection', async () => {
    // Dropping three pages of two is impossible too, but the page count is the cause.
    const pdf = await pdfWithPages([100, 200])

    await expect(selectPdfPages(pdf, { skipLast: 3, total: 5 })).rejects.toThrow(/2 pages where 5 were expected/)
  })
})

describe('reading the render details stored on a document', () => {
  const slots = { 'contract:host': 'customer', 'contract:anchor': 'company' }
  const valid = { htmlPath: 'documents/doc-1/source.html', profile: 'a4_css_page', pages: { skipLast: 1 }, slots, hasInitials: true }

  it('returns the details when they are complete', () => {
    expect(readSigningRenderSpec({ render: valid, sender_position: 'Director' })).toEqual({
      htmlPath: 'documents/doc-1/source.html',
      profile: 'a4_css_page',
      pages: { skipLast: 1 },
      slots,
      hasInitials: true,
    })
  })

  it('accepts each way a template can be printed', () => {
    const profiles: SigningPdfProfile[] = ['a4_css_page', 'a4_margins', 'a4_compact']
    for (const profile of profiles) {
      expect(readSigningRenderSpec({ render: { ...valid, profile } })?.profile, profile).toBe(profile)
    }
  })

  it('has no page selection when none was stored', () => {
    const spec = readSigningRenderSpec({ render: { htmlPath: 'a.html', profile: 'a4_margins', slots: { 'doc:worker': 'worker' } } })

    expect(spec).not.toBeNull()
    expect(spec?.pages).toBeUndefined()
    expect(spec?.hasInitials).toBe(false)
  })

  it('passes on the page count the selection was worked out for', () => {
    const contract = readSigningRenderSpec({ render: { ...valid, pages: { skipLast: 1, total: 5 } } })
    const annex = readSigningRenderSpec({ render: { ...valid, pages: { onlyLast: 1, total: 5 } } })
    const whole = readSigningRenderSpec({ render: { ...valid, pages: { total: 4 } } })

    expect(contract?.pages).toEqual({ skipLast: 1, total: 5 })
    expect(annex?.pages).toEqual({ onlyLast: 1, total: 5 })
    expect(whole?.pages).toEqual({ total: 4 })
  })

  it('keeps only the details it knows, dropping anything else stored beside them', () => {
    const spec = readSigningRenderSpec({ render: { ...valid, html: '<p>stale</p>', extra: 1 } })

    expect(Object.keys(spec ?? {}).sort()).toEqual(['hasInitials', 'htmlPath', 'pages', 'profile', 'slots'])
  })

  it('returns nothing for a document sent before signatures were shown in place', () => {
    expect(readSigningRenderSpec(null)).toBeNull()
    expect(readSigningRenderSpec(undefined)).toBeNull()
    expect(readSigningRenderSpec({})).toBeNull()
    expect(readSigningRenderSpec({ sender_position: 'Director' })).toBeNull()
    expect(readSigningRenderSpec({ render: null })).toBeNull()
  })

  it('returns nothing when what is stored is not a set of render details', () => {
    expect(readSigningRenderSpec({ render: 'a4_css_page' })).toBeNull()
    expect(readSigningRenderSpec({ render: 42 })).toBeNull()
    expect(readSigningRenderSpec({ render: true })).toBeNull()
  })

  it('returns nothing when the profile is missing or not one it knows', () => {
    expect(readSigningRenderSpec({ render: { ...valid, profile: 'letter' } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, profile: 'A4_CSS_PAGE' } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, profile: undefined } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, profile: null } })).toBeNull()
  })

  it('returns nothing when the slots are missing', () => {
    expect(readSigningRenderSpec({ render: { ...valid, slots: undefined } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, slots: null } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, slots: 'contract:host' } })).toBeNull()
  })

  it('returns nothing when the path to the stored HTML is missing', () => {
    expect(readSigningRenderSpec({ render: { ...valid, htmlPath: undefined } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, htmlPath: null } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, htmlPath: 42 } })).toBeNull()
  })

  it('says the document has initials only when that was stored as true', () => {
    expect(readSigningRenderSpec({ render: { ...valid, hasInitials: true } })?.hasInitials).toBe(true)
    for (const stored of [false, undefined, null, 'true', 1, 'yes', {}]) {
      expect(readSigningRenderSpec({ render: { ...valid, hasInitials: stored } })?.hasInitials, String(stored)).toBe(false)
    }
  })
})

describe('rendering filled HTML to the pages of one document', () => {
  const html = '<html><body><p>Filled document</p></body></html>'

  it('prints a template that owns its A4 sheets at its own page size, with no added margins', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))

    await renderSigningPdf({ html, profile: 'a4_css_page' })

    expect(state.generatePdf).toHaveBeenCalledTimes(1)
    const [passedHtml, pdfOptions] = state.generatePdf.mock.calls[0]
    expect(passedHtml).toBe(html)
    expect(pdfOptions).toMatchObject({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  })

  it('leaves flowing template text to the standard margins of the PDF generator', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))

    await renderSigningPdf({ html, profile: 'a4_margins' })

    const [passedHtml, pdfOptions] = state.generatePdf.mock.calls[0]
    expect(passedHtml).toBe(html)
    expect(pdfOptions).toBeUndefined()
  })

  it('prints a quote with the 8mm margins the quote PDF uses', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))

    await renderSigningPdf({ html, profile: 'a4_compact' })

    const [, pdfOptions] = state.generatePdf.mock.calls[0]
    expect(pdfOptions).toMatchObject({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
    })
  })

  it('uses the browser the caller already started', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))
    const browser = { fake: 'browser' } as unknown as NonNullable<RenderInput['browser']>

    await renderSigningPdf({ html, profile: 'a4_css_page', browser })

    const browserOptions = state.generatePdf.mock.calls[0][2] as { browser?: unknown }
    expect(Object.keys(browserOptions)).toEqual(['browser'])
    expect(browserOptions.browser).toBe(browser)
  })

  it('names no browser when the caller did not start one', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))

    await renderSigningPdf({ html, profile: 'a4_css_page' })

    expect(state.generatePdf.mock.calls[0][2]).toEqual({})
  })

  it('returns every page when no pages are chosen', async () => {
    const generated = await pdfWithPages([100, 200, 300])
    state.generatePdf.mockResolvedValue(generated)

    const pdf = await renderSigningPdf({ html, profile: 'a4_css_page' })

    expect(pdf).toBe(generated)
  })

  it('keeps only the pages that belong to this document', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100, 200, 300]))

    const contract = await renderSigningPdf({ html, profile: 'a4_css_page', pages: { skipLast: 1 } })
    const annex = await renderSigningPdf({ html, profile: 'a4_css_page', pages: { onlyLast: 1 } })

    expect(await pagesOf(contract)).toEqual([100, 200])
    expect(await pagesOf(annex)).toEqual([300])
  })

  it('fails when the render came out too short for the pages it was told to keep', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))

    await expect(renderSigningPdf({ html, profile: 'a4_css_page', pages: { skipLast: 1 } })).rejects.toThrow(
      /Cannot select pages/
    )
  })

  it('fails when the render does not have the page count the selection was worked out for', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100, 200, 300, 400]))

    await expect(renderSigningPdf({ html, profile: 'a4_css_page', pages: { skipLast: 1, total: 3 } })).rejects.toThrow(
      /4 pages where 3 were expected/
    )
    await expect(renderSigningPdf({ html, profile: 'a4_css_page', pages: { total: 3 } })).rejects.toThrow(
      /4 pages where 3 were expected/
    )
  })

  it('returns the whole render when only its page count is checked and it is right', async () => {
    const generated = await pdfWithPages([100, 200, 300, 400])
    state.generatePdf.mockResolvedValue(generated)

    expect(await renderSigningPdf({ html, profile: 'a4_css_page', pages: { total: 4 } })).toBe(generated)
  })

  it('fails when the PDF could not be generated', async () => {
    state.generatePdf.mockRejectedValue(new Error('browser crashed'))

    await expect(renderSigningPdf({ html, profile: 'a4_margins' })).rejects.toThrow('browser crashed')
  })
})

describe('counting the pages of a rendered PDF', () => {
  it('counts the pages', async () => {
    expect(await countPdfPages(await pdfWithPages([100]))).toBe(1)
    expect(await countPdfPages(await pdfWithPages([100, 200, 300]))).toBe(3)
  })

  it('counts what is left after pages are chosen', async () => {
    const pdf = await pdfWithPages([100, 200, 300, 400])

    expect(await countPdfPages(await selectPdfPages(pdf, { skipLast: 1 }))).toBe(3)
    expect(await countPdfPages(await selectPdfPages(pdf, { onlyLast: 1 }))).toBe(1)
  })

  it('fails for bytes that are not a PDF', async () => {
    await expect(countPdfPages(Buffer.from('this is not a PDF'))).rejects.toThrow()
  })
})
