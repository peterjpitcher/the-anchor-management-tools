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

import { PdfSheetOverflowError } from '@/lib/pdf/sheet-overflow'
import {
  SigningPageCountError,
  SigningPageRangeError,
  countPdfPages,
  isUntrustedRender,
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

describe('telling a render that cannot be trusted from one that simply failed', () => {
  it('says which error it is when the page count is wrong, with both counts', async () => {
    const pdf = await pdfWithPages([100, 200, 300, 400, 500, 600])

    const failure = await selectPdfPages(pdf, { skipLast: 1, total: 5 }).then(
      () => null,
      (error: unknown) => error
    )

    expect(failure).toBeInstanceOf(SigningPageCountError)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ name: 'SigningPageCountError', actual: 6, expected: 5 })
    expect((failure as Error).message).toContain('6 pages where 5 were expected')
  })

  it('throws the same error for a wrong count whether pages are dropped, kept or all kept', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    for (const pages of [{ skipLast: 1, total: 4 }, { onlyLast: 1, total: 4 }, { total: 4 }, { total: 2 }]) {
      await expect(selectPdfPages(pdf, pages), JSON.stringify(pages)).rejects.toBeInstanceOf(SigningPageCountError)
    }
  })

  it('counts a wrong page count and a sheet that overflowed as renders that cannot be trusted', () => {
    expect(isUntrustedRender(new SigningPageCountError(6, 5))).toBe(true)
    expect(isUntrustedRender(new PdfSheetOverflowError([3]))).toBe(true)
  })

  it('says which error it is when the pages asked for are not in the render at all', async () => {
    const impossible: Array<{ sizes: number[]; pages: { skipLast?: number; onlyLast?: number } }> = [
      { sizes: [100], pages: { skipLast: 1 } },
      { sizes: [100, 200], pages: { skipLast: 3 } },
      { sizes: [100, 200], pages: { onlyLast: 3 } },
    ]

    for (const { sizes, pages } of impossible) {
      const failure = await selectPdfPages(await pdfWithPages(sizes), pages).then(
        () => null,
        (error: unknown) => error
      )

      expect(failure, JSON.stringify(pages)).toBeInstanceOf(SigningPageRangeError)
      expect(failure, JSON.stringify(pages)).toBeInstanceOf(Error)
      expect((failure as Error).name).toBe('SigningPageRangeError')
      expect((failure as Error).message).toMatch(new RegExp(`Cannot select pages .* of a ${sizes.length} page document`))
      // A render the selection does not fit is one that cannot be trusted, like a wrong page count.
      expect(isUntrustedRender(failure), JSON.stringify(pages)).toBe(true)
    }
  })

  it('counts nothing else as one', async () => {
    const askedForBoth = await selectPdfPages(await pdfWithPages([100, 200]), { skipLast: 1, onlyLast: 1 }).then(
      () => null,
      (error: unknown) => error
    )
    expect(askedForBoth).toBeInstanceOf(Error)

    const others: unknown[] = [
      // A selection that contradicts itself is a fault in what was stored, not in the render.
      askedForBoth,
      { name: 'SigningPageRangeError', message: 'Cannot select pages 1 to 0 of a 1 page document' },
      new Error('Cannot select pages 1 to 0 of a 1 page document'),
      new Error('Failed to generate PDF'),
      new Error('The document printed as 6 pages where 5 were expected'),
      Object.assign(new Error('The stored document source does not match its fingerprint.'), { code: 'fingerprint_mismatch' }),
      { name: 'PdfSheetOverflowError', sheets: [1] },
      { name: 'SigningPageCountError', actual: 6, expected: 5 },
      'PdfSheetOverflowError',
      null,
      undefined,
    ]
    for (const other of others) expect(isUntrustedRender(other), String(other)).toBe(false)
  })

  it('refuses a selection that asks both to drop pages from the end and to keep them', async () => {
    const pdf = await pdfWithPages([100, 200, 300])

    for (const pages of [{ skipLast: 1, onlyLast: 1 }, { skipLast: 1, onlyLast: 1, total: 3 }, { skipLast: 2, onlyLast: 3 }]) {
      const failure = await selectPdfPages(pdf, pages).then(
        () => null,
        (error: unknown) => error
      )
      expect(failure, JSON.stringify(pages)).toBeInstanceOf(Error)
      expect((failure as Error).message, JSON.stringify(pages)).toContain('not both')
    }
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
  /** A fingerprint of the right shape: 64 lower case hex characters. */
  const FINGERPRINT = '0123456789abcdef'.repeat(4)
  const valid = {
    htmlPath: 'documents/doc-1/source.html',
    htmlSha256: FINGERPRINT,
    profile: 'a4_css_page',
    pages: { skipLast: 1 },
    slots,
    hasInitials: true,
  }

  it('returns the details when they are complete', () => {
    expect(readSigningRenderSpec({ render: valid, sender_position: 'Director' })).toEqual({
      htmlPath: 'documents/doc-1/source.html',
      htmlSha256: FINGERPRINT,
      profile: 'a4_css_page',
      pages: { skipLast: 1 },
      slots,
      hasInitials: true,
    })
  })

  it('returns nothing when the stored HTML has no fingerprint, so the signed copy is never printed from an unchecked file', () => {
    const { htmlSha256: _dropped, ...withoutFingerprint } = valid

    expect(readSigningRenderSpec({ render: withoutFingerprint })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, htmlSha256: undefined } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, htmlSha256: null } })).toBeNull()
    expect(readSigningRenderSpec({ render: { ...valid, htmlSha256: '' } })).toBeNull()
  })

  it('returns nothing when the fingerprint is not 64 lower case hex characters', () => {
    const malformed: unknown[] = [
      FINGERPRINT.slice(0, 63),
      `${FINGERPRINT}0`,
      FINGERPRINT.toUpperCase(),
      `${FINGERPRINT.slice(0, 63)}g`,
      ` ${FINGERPRINT.slice(1)}`,
      `${FINGERPRINT}\n`,
      `sha256:${FINGERPRINT.slice(7)}`,
      12345,
      true,
      { hex: FINGERPRINT },
    ]

    for (const htmlSha256 of malformed) {
      expect(readSigningRenderSpec({ render: { ...valid, htmlSha256 } }), JSON.stringify(htmlSha256)).toBeNull()
    }
  })

  it('accepts any well formed fingerprint and passes it on unchanged', () => {
    for (const htmlSha256 of ['0'.repeat(64), 'f'.repeat(64), 'a1b2c3d4'.repeat(8)]) {
      expect(readSigningRenderSpec({ render: { ...valid, htmlSha256 } })?.htmlSha256).toBe(htmlSha256)
    }
  })

  it('accepts each way a template can be printed', () => {
    const profiles: SigningPdfProfile[] = ['a4_css_page', 'a4_margins', 'a4_compact']
    for (const profile of profiles) {
      expect(readSigningRenderSpec({ render: { ...valid, profile } })?.profile, profile).toBe(profile)
    }
  })

  it('has no page selection when none was stored', () => {
    const spec = readSigningRenderSpec({
      render: { htmlPath: 'a.html', htmlSha256: FINGERPRINT, profile: 'a4_margins', slots: { 'doc:worker': 'worker' } },
    })

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

    expect(Object.keys(spec ?? {}).sort()).toEqual(['hasInitials', 'htmlPath', 'htmlSha256', 'pages', 'profile', 'slots'])
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

  it('uses the browser the caller already started, whatever the profile', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))
    const browser = { fake: 'browser' } as unknown as NonNullable<RenderInput['browser']>
    const profiles: SigningPdfProfile[] = ['a4_css_page', 'a4_margins', 'a4_compact']

    for (const profile of profiles) {
      state.generatePdf.mockClear()
      await renderSigningPdf({ html, profile, browser })

      const generatorOptions = state.generatePdf.mock.calls[0][2] as { browser?: unknown }
      expect(generatorOptions.browser, profile).toBe(browser)
    }
  })

  it('names no browser when the caller did not start one', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))
    const profiles: SigningPdfProfile[] = ['a4_css_page', 'a4_margins', 'a4_compact']

    for (const profile of profiles) {
      state.generatePdf.mockClear()
      await renderSigningPdf({ html, profile })

      expect(state.generatePdf.mock.calls[0][2], profile).not.toHaveProperty('browser')
    }
  })

  it('refuses a render that runs off the bottom of a sheet, for a template made of fixed A4 sheets', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))
    const browser = { fake: 'browser' } as unknown as NonNullable<RenderInput['browser']>

    await renderSigningPdf({ html, profile: 'a4_css_page' })
    await renderSigningPdf({ html, profile: 'a4_css_page', browser })

    expect(state.generatePdf.mock.calls[0][2]).toEqual({ refuseClippedSheets: true })
    expect(state.generatePdf.mock.calls[1][2]).toEqual({ browser, refuseClippedSheets: true })
  })

  it('does not ask for the sheet check on flowing text, which has no fixed sheets to run off', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))
    const browser = { fake: 'browser' } as unknown as NonNullable<RenderInput['browser']>

    for (const profile of ['a4_margins', 'a4_compact'] as const) {
      state.generatePdf.mockClear()
      await renderSigningPdf({ html, profile })
      await renderSigningPdf({ html, profile, browser })

      expect(state.generatePdf.mock.calls[0][2], profile).toEqual({})
      expect(state.generatePdf.mock.calls[1][2], profile).toEqual({ browser })
    }
  })

  it('passes on the refusal, naming the pages, when a sheet has more on it than fits', async () => {
    const overflow = new PdfSheetOverflowError([2, 4])
    state.generatePdf.mockRejectedValue(overflow)

    const failure = await renderSigningPdf({ html, profile: 'a4_css_page' }).then(
      () => null,
      (error: unknown) => error
    )

    expect(failure).toBe(overflow)
    expect(isUntrustedRender(failure)).toBe(true)
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
