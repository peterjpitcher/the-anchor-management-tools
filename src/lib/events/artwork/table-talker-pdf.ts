/**
 * Draws the A4 table talker sheet as a PDF: the branded panel three times, with
 * crop marks, laid out by `print-sheet.ts`.
 *
 * A PDF rather than an image because a PDF states its own physical size. Each
 * panel is placed at an exact millimetre position, so what comes out of the
 * printer does not depend on anyone choosing the right scaling, provided the
 * print dialog is left at actual size. The file asks for that itself (see
 * `PrintScaling.None` below), and the download button says it as well, because
 * not every viewer honours the request.
 *
 * The image is embedded once and drawn three times, so the sheet is barely
 * larger than the panel. It is never resampled: the panel's own pixels are
 * placed at the panel's printed size, which is where the print resolution
 * comes from.
 *
 * `pdf-lib` is imported dynamically, as at every other call site in this repo,
 * to keep it out of any bundle that does not build a PDF.
 */

import {
  SHEET_HEIGHT_MM,
  SHEET_WIDTH_MM,
  tableTalkerSheetLayout,
  type TableTalkerSheetLayout,
} from './print-sheet'

/** PDF user space is points: 72 to the inch, 25.4mm to the inch. */
const PT_PER_MM = 72 / 25.4

/** Hairline crop marks, in a mid grey so they read clearly without shouting. */
const CROP_MARK_THICKNESS_PT = 0.25
const CROP_MARK_GREY = 0.45

export type SheetImageFormat = 'png' | 'jpeg'

export interface TableTalkerPdfInput {
  /** The branded panel exactly as stored. */
  image: Buffer
  format: SheetImageFormat
  /** Shown as the PDF's title, e.g. in the print dialog. */
  eventName: string
}

export interface TableTalkerPdfResult {
  bytes: Uint8Array
  /**
   * The layout the sheet was drawn with, including the resolution it prints
   * at. Worked out from the image pdf-lib actually embedded, so the size that
   * decides the fit is the size that gets printed, with no second decoder that
   * could read the file differently.
   */
  layout: TableTalkerSheetLayout
}

/** What a stored image really is, from its first bytes rather than its name. */
export function sniffSheetImageFormat(buffer: Buffer): SheetImageFormat | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg'
  }
  return null
}

/** Millimetres from the top of the sheet to PDF points from the bottom. */
function yFromBottomPt(yMm: number): number {
  return (SHEET_HEIGHT_MM - yMm) * PT_PER_MM
}

export async function buildTableTalkerSheetPdf(input: TableTalkerPdfInput): Promise<TableTalkerPdfResult> {
  const { PDFDocument, PrintScaling, rgb } = await import('pdf-lib')

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Table talkers: ${input.eventName}`)
  pdf.setSubject('Three table talkers on one A4 sheet. Print at actual size (100%), then cut on the marks.')
  pdf.setCreator('Anchor Management Tools')
  // Asks the viewer to default the print dialog to actual size, not fit to page.
  pdf.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)

  const page = pdf.addPage([SHEET_WIDTH_MM * PT_PER_MM, SHEET_HEIGHT_MM * PT_PER_MM])
  const embedded = input.format === 'png' ? await pdf.embedPng(input.image) : await pdf.embedJpg(input.image)
  const layout = tableTalkerSheetLayout(embedded.width, embedded.height)

  for (const rect of layout.artwork) {
    page.drawImage(embedded, {
      x: rect.x * PT_PER_MM,
      y: yFromBottomPt(rect.y + rect.height),
      width: rect.width * PT_PER_MM,
      height: rect.height * PT_PER_MM,
    })
  }

  const grey = rgb(CROP_MARK_GREY, CROP_MARK_GREY, CROP_MARK_GREY)
  for (const mark of layout.cropMarks) {
    page.drawLine({
      start: { x: mark.x1 * PT_PER_MM, y: yFromBottomPt(mark.y1) },
      end: { x: mark.x2 * PT_PER_MM, y: yFromBottomPt(mark.y2) },
      thickness: CROP_MARK_THICKNESS_PT,
      color: grey,
    })
  }

  return { bytes: await pdf.save(), layout }
}
