import { afterEach, describe, expect, it } from 'vitest'
import { FIND_CLIPPED_SHEETS, PdfSheetOverflowError } from '@/lib/pdf/sheet-overflow'

/**
 * The check that stops a fixed-sheet document being printed with text missing off the bottom of
 * a page. The script runs inside the page being printed. Here it runs against a small DOM whose
 * heights are set by hand, because jsdom lays nothing out: every height it reports is zero.
 */

type Heights = { scroll: number; client: number }

/** Give an element the heights a browser would report after laying it out. */
function setHeights(element: Element, heights: Heights): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: heights.scroll })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: heights.client })
}

/**
 * A sheet as the contract and the worker agreement print it: a fixed sheet, an inner frame, and
 * inside that frame its parts (header, body, footer). The parts go inside the frame when there
 * is one, and straight inside the sheet when there is not.
 */
function addSheet(sheet: Heights, inner?: Heights, parts: Heights[] = []): HTMLElement {
  const section = document.createElement('section')
  section.className = 'sheet'
  setHeights(section, sheet)
  let frame: HTMLElement = section
  if (inner) {
    frame = document.createElement('div')
    frame.className = 'sheet-inner'
    setHeights(frame, inner)
    section.appendChild(frame)
  }
  for (const part of parts) {
    const element = document.createElement('div')
    setHeights(element, part)
    frame.appendChild(element)
  }
  document.body.appendChild(section)
  return section
}

/** Run the script as the PDF generator does: evaluated in the page, giving back what it returns. */
function findClippedSheets(): number[] {
  // The script is one expression. A function built from it runs in the global scope, where
  // `document` is the page.
  return new Function(`return ${FIND_CLIPPED_SHEETS}`)() as number[]
}

const FITS: Heights = { scroll: 1123, client: 1123 }
const SHEET = 1123

afterEach(() => {
  document.body.innerHTML = ''
})

describe('finding the sheets that have more on them than fits', () => {
  it('finds none in a document with no fixed sheets', () => {
    document.body.innerHTML = '<main><p>Flowing text, which simply runs on to the next page.</p></main>'

    expect(findClippedSheets()).toEqual([])
  })

  it('finds none when everything fits', () => {
    addSheet(FITS, FITS)
    addSheet(FITS, FITS)

    expect(findClippedSheets()).toEqual([])
  })

  it('names the pages that overflow, counting from one, in the order they are printed', () => {
    addSheet(FITS, FITS)
    addSheet({ scroll: SHEET + 40, client: SHEET }, FITS)
    addSheet(FITS, FITS)
    addSheet(FITS, { scroll: SHEET + 12, client: SHEET })
    addSheet(FITS, FITS)

    expect(findClippedSheets()).toEqual([2, 4])
  })

  it('allows a sheet two pixels of rounding and no more', () => {
    addSheet({ scroll: SHEET + 1, client: SHEET }, FITS)
    addSheet({ scroll: SHEET + 2, client: SHEET }, FITS)
    addSheet({ scroll: SHEET + 3, client: SHEET }, FITS)

    expect(findClippedSheets()).toEqual([3])
  })

  it('allows the content inside a sheet the same two pixels and no more', () => {
    addSheet(FITS, { scroll: 1040 + 1, client: 1040 })
    addSheet(FITS, { scroll: 1040 + 2, client: 1040 })
    addSheet(FITS, { scroll: 1040 + 3, client: 1040 })

    expect(findClippedSheets()).toEqual([3])
  })

  it('catches content that overflows inside a sheet whose own height looks right', () => {
    // The sheet hides what does not fit, so its own measurements can match while its content runs over.
    addSheet(FITS, { scroll: 1300, client: 1040 })

    expect(findClippedSheets()).toEqual([1])
  })

  it('catches a sheet that overflows even when the content inside it measures as fitting', () => {
    addSheet({ scroll: 1300, client: SHEET }, { scroll: 1040, client: 1040 })

    expect(findClippedSheets()).toEqual([1])
  })

  // The body of a sheet is allowed to shrink. Text a little too long does not pass the bottom of
  // the sheet: it runs over the footer, and neither the sheet nor its frame measures any taller.
  describe('text that runs over the footer without passing the bottom of the sheet', () => {
    const HEADER: Heights = { scroll: 60, client: 60 }
    const FOOTER: Heights = { scroll: 40, client: 40 }
    const BODY_BOX = 940
    const bodyOver = (pixels: number): Heights => ({ scroll: BODY_BOX + pixels, client: BODY_BOX })

    it('is caught from the body alone, with the sheet and its frame measuring as they should', () => {
      addSheet(FITS, FITS, [HEADER, bodyOver(0), FOOTER])
      addSheet(FITS, FITS, [HEADER, bodyOver(28), FOOTER])
      addSheet(FITS, FITS, [HEADER, bodyOver(0), FOOTER])

      expect(findClippedSheets()).toEqual([2])
    })

    it('allows each part two pixels of rounding and no more', () => {
      addSheet(FITS, FITS, [HEADER, bodyOver(1), FOOTER])
      addSheet(FITS, FITS, [HEADER, bodyOver(2), FOOTER])
      addSheet(FITS, FITS, [HEADER, bodyOver(3), FOOTER])

      expect(findClippedSheets()).toEqual([3])
    })

    it('measures every part of the sheet, not only the body', () => {
      addSheet(FITS, FITS, [{ scroll: 90, client: 60 }, bodyOver(0), FOOTER])
      addSheet(FITS, FITS, [HEADER, bodyOver(0), FOOTER])
      addSheet(FITS, FITS, [HEADER, bodyOver(0), { scroll: 55, client: 40 }])

      expect(findClippedSheets()).toEqual([1, 3])
    })

    it('names the page once however many of its parts run over', () => {
      addSheet(FITS, FITS, [{ scroll: 90, client: 60 }, bodyOver(30), { scroll: 55, client: 40 }])

      expect(findClippedSheets()).toEqual([1])
    })

    it('does not count parts that are shorter than their box, or a sheet with no parts at all', () => {
      addSheet(FITS, FITS, [HEADER, { scroll: 300, client: BODY_BOX }, FOOTER])
      addSheet(FITS, FITS, [])

      expect(findClippedSheets()).toEqual([])
    })

    it('measures the parts straight inside a sheet that has no inner frame', () => {
      addSheet(FITS, undefined, [HEADER, bodyOver(0), FOOTER])
      addSheet(FITS, undefined, [HEADER, bodyOver(28), FOOTER])

      expect(findClippedSheets()).toEqual([2])
    })
  })

  it('measures the sheet itself when it has no inner content element', () => {
    addSheet(FITS)
    addSheet({ scroll: SHEET + 3, client: SHEET })
    addSheet({ scroll: SHEET + 2, client: SHEET })

    expect(findClippedSheets()).toEqual([2])
  })

  it('names a page once when both the sheet and its content overflow', () => {
    addSheet({ scroll: 1300, client: SHEET }, { scroll: 1300, client: 1040 })

    expect(findClippedSheets()).toEqual([1])
  })

  it('does not count a sheet with less on it than fills it', () => {
    addSheet({ scroll: 600, client: SHEET }, { scroll: 500, client: 1040 })

    expect(findClippedSheets()).toEqual([])
  })

  it('looks only at sheets, not at other tall things on the page', () => {
    const tall = document.createElement('div')
    tall.className = 'body'
    setHeights(tall, { scroll: 5000, client: 100 })
    document.body.appendChild(tall)
    addSheet(FITS, FITS)

    expect(findClippedSheets()).toEqual([])
  })

  it('gives back a plain list of numbers, so it survives the trip out of the page', () => {
    addSheet({ scroll: 1300, client: SHEET }, FITS)

    const clipped = findClippedSheets()

    expect(Array.isArray(clipped)).toBe(true)
    expect(JSON.parse(JSON.stringify(clipped))).toEqual([1])
  })
})

describe('the error raised when a document does not fit on its pages', () => {
  it('names the one page and asks for that page to be shortened', () => {
    const error = new PdfSheetOverflowError([2])

    expect(error.message).toContain('does not fit on its pages (page 2)')
    expect(error.message).toContain('that page')
    expect(error.message).not.toContain('those pages')
  })

  it('names every page and asks for those pages to be shortened', () => {
    const error = new PdfSheetOverflowError([1, 3, 4])

    expect(error.message).toContain('(page 1, 3, 4)')
    expect(error.message).toContain('those pages')
  })

  it('is an error that carries the page numbers, and can be told from any other', () => {
    const error = new PdfSheetOverflowError([2, 5])

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(PdfSheetOverflowError)
    expect(error.name).toBe('PdfSheetOverflowError')
    expect(error.sheets).toEqual([2, 5])
    expect(new Error('Failed to generate PDF')).not.toBeInstanceOf(PdfSheetOverflowError)
  })
})
