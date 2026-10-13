// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A document made of fixed A4 sheets hides whatever does not fit on a sheet. Printed like that,
// the text is simply missing from the PDF. A render that asks for the sheet check must stop and
// say which pages, and that refusal must reach the caller as itself, not as a generic failure.

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
}))

// Nothing here may start a real browser. A render with no browser of its own gets this one.
vi.mock('puppeteer', () => ({
  default: { launch: mocks.launch, executablePath: () => '/local/chrome' },
}))
vi.mock('@sparticuz/chromium', () => ({
  default: { executablePath: async () => '/tmp/chromium', args: ['--headless=shell'] },
}))

import { FIND_CLIPPED_SHEETS, PdfSheetOverflowError } from '@/lib/pdf/sheet-overflow'
import { generatePDFFromHTML } from '@/lib/pdf-generator'

type GeneratorBrowser = NonNullable<NonNullable<Parameters<typeof generatePDFFromHTML>[2]>['browser']>

const HTML = '<html><body><section class="sheet"><div class="sheet-inner">Contract</div></section></body></html>'
const PRINTED = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])

/** A stand-in for the page the generator prints from, noting what it was asked to do and in what order. */
function fakePage(clipped: unknown = []) {
  const steps: string[] = []
  const page = {
    setViewport: vi.fn(async () => {
      steps.push('setViewport')
    }),
    setContent: vi.fn(async () => {
      steps.push('setContent')
    }),
    addStyleTag: vi.fn(async () => {
      steps.push('addStyleTag')
    }),
    emulateMediaType: vi.fn(async (type: string) => {
      steps.push(`emulateMediaType:${type}`)
    }),
    evaluate: vi.fn(async (_script: string): Promise<unknown> => {
      steps.push('evaluate')
      return clipped
    }),
    pdf: vi.fn(async (_options: unknown): Promise<Uint8Array> => {
      steps.push('pdf')
      return PRINTED
    }),
    close: vi.fn(async () => {
      steps.push('close')
    }),
  }
  return { page, steps }
}

function fakeBrowser(page: ReturnType<typeof fakePage>['page']) {
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  }
  // Cast: the generator's browser type is its own, and only these two members are used.
  return { browser, asGeneratorBrowser: browser as unknown as GeneratorBrowser }
}

const originalVercel = process.env.VERCEL
// The generator logs a failed render. Keep the run quiet, and let a test check what was logged.
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
  mocks.launch.mockReset()
  consoleError.mockClear()
  // Off Vercel the generator uses the local browser path, so nothing is unpacked.
  delete process.env.VERCEL
})

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = originalVercel
})

afterAll(() => {
  consoleError.mockRestore()
})

describe('printing a document without the sheet check', () => {
  it('prints straight away, without measuring anything', async () => {
    const { page, steps } = fakePage()
    const { asGeneratorBrowser } = fakeBrowser(page)

    const pdf = await generatePDFFromHTML(HTML, undefined, { browser: asGeneratorBrowser })

    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.equals(Buffer.from(PRINTED))).toBe(true)
    expect(page.emulateMediaType).not.toHaveBeenCalled()
    expect(page.evaluate).not.toHaveBeenCalled()
    expect(steps).toEqual(['setViewport', 'setContent', 'addStyleTag', 'pdf', 'close'])
  })

  it('does the same when the check is switched off by name', async () => {
    const { page } = fakePage([1, 2])
    const { asGeneratorBrowser } = fakeBrowser(page)

    await generatePDFFromHTML(HTML, undefined, { browser: asGeneratorBrowser, refuseClippedSheets: false })

    expect(page.evaluate).not.toHaveBeenCalled()
    expect(page.pdf).toHaveBeenCalledTimes(1)
  })
})

describe('printing a document with the sheet check', () => {
  it('measures the sheets as they will print, after the document has loaded and before it prints', async () => {
    const { page, steps } = fakePage([])
    const { asGeneratorBrowser } = fakeBrowser(page)

    const pdf = await generatePDFFromHTML(HTML, { preferCSSPageSize: true }, { browser: asGeneratorBrowser, refuseClippedSheets: true })

    expect(pdf.equals(Buffer.from(PRINTED))).toBe(true)
    expect(steps).toEqual(['setViewport', 'setContent', 'addStyleTag', 'emulateMediaType:print', 'evaluate', 'pdf', 'close'])
    // The script run in the page is the one that finds clipped sheets, exactly as it is exported.
    expect(page.evaluate).toHaveBeenCalledTimes(1)
    expect(page.evaluate).toHaveBeenCalledWith(FIND_CLIPPED_SHEETS)
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ preferCSSPageSize: true }))
  })

  it('refuses to print, naming the pages, when a sheet has more on it than fits', async () => {
    const { page, steps } = fakePage([2, 5])
    const { browser, asGeneratorBrowser } = fakeBrowser(page)

    const failure = await generatePDFFromHTML(HTML, undefined, { browser: asGeneratorBrowser, refuseClippedSheets: true }).then(
      () => null,
      (error: unknown) => error
    )

    expect(failure).toBeInstanceOf(PdfSheetOverflowError)
    expect(failure).toMatchObject({ name: 'PdfSheetOverflowError', sheets: [2, 5] })
    expect((failure as Error).message).toContain('page 2, 5')
    // It reaches the caller as itself, so the caller can tell it from a fault in the generator.
    expect((failure as Error).message).not.toBe('Failed to generate PDF')
    // Nothing was printed, and the page was tidied away.
    expect(page.pdf).not.toHaveBeenCalled()
    expect(steps[steps.length - 1]).toBe('close')
    // The browser belongs to the caller, who may have more to print with it.
    expect(browser.close).not.toHaveBeenCalled()
    // Not a generator fault, so it is not logged as one.
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('refuses for a single page too', async () => {
    const { page } = fakePage([1])
    const { asGeneratorBrowser } = fakeBrowser(page)

    await expect(
      generatePDFFromHTML(HTML, undefined, { browser: asGeneratorBrowser, refuseClippedSheets: true })
    ).rejects.toMatchObject({ name: 'PdfSheetOverflowError', sheets: [1] })
  })

  it('closes the browser it started itself when it refuses, and still passes the refusal on unchanged', async () => {
    const { page } = fakePage([3])
    const { browser } = fakeBrowser(page)
    mocks.launch.mockResolvedValue(browser)

    const failure = await generatePDFFromHTML(HTML, undefined, { refuseClippedSheets: true }).then(
      () => null,
      (error: unknown) => error
    )

    expect(mocks.launch).toHaveBeenCalledTimes(1)
    expect(failure).toBeInstanceOf(PdfSheetOverflowError)
    expect(failure).toMatchObject({ sheets: [3] })
    expect(page.pdf).not.toHaveBeenCalled()
    expect(page.close).toHaveBeenCalledTimes(1)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })
})

describe('every other fault while printing', () => {
  it('is still reported as a failure to generate the PDF, whichever step it came from', async () => {
    const faults: Array<{ step: string; breakIt: (page: ReturnType<typeof fakePage>['page']) => void }> = [
      { step: 'loading the document', breakIt: (page) => page.setContent.mockRejectedValue(new Error('Navigation timeout')) },
      { step: 'switching to print', breakIt: (page) => page.emulateMediaType.mockRejectedValue(new Error('Target closed')) },
      { step: 'measuring the sheets', breakIt: (page) => page.evaluate.mockRejectedValue(new Error('Execution context was destroyed')) },
      { step: 'printing', breakIt: (page) => page.pdf.mockRejectedValue(new Error('Protocol error')) },
    ]

    for (const { step, breakIt } of faults) {
      const { page } = fakePage([])
      const { asGeneratorBrowser } = fakeBrowser(page)
      breakIt(page)

      const failure = await generatePDFFromHTML(HTML, undefined, { browser: asGeneratorBrowser, refuseClippedSheets: true }).then(
        () => null,
        (error: unknown) => error
      )

      expect(failure, step).toBeInstanceOf(Error)
      expect(failure, step).not.toBeInstanceOf(PdfSheetOverflowError)
      expect((failure as Error).message, step).toBe('Failed to generate PDF')
      expect(page.close, step).toHaveBeenCalledTimes(1)
    }
    expect(consoleError).toHaveBeenCalledTimes(faults.length)
  })

  it('does not print when measuring the sheets itself failed', async () => {
    const { page } = fakePage([])
    const { asGeneratorBrowser } = fakeBrowser(page)
    page.evaluate.mockRejectedValue(new Error('Execution context was destroyed'))

    await expect(
      generatePDFFromHTML(HTML, undefined, { browser: asGeneratorBrowser, refuseClippedSheets: true })
    ).rejects.toThrow('Failed to generate PDF')

    expect(page.pdf).not.toHaveBeenCalled()
  })
})
