// @vitest-environment node
// pdf-lib checks its input with `instanceof Uint8Array`, which a Node Buffer
// fails under jsdom's separate realm. This module only ever runs on the server.
import { inflateSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PrintScaling } from 'pdf-lib'
import sharp from 'sharp'
import { buildTableTalkerSheetPdf, sniffSheetImageFormat } from './table-talker-pdf'
import { SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from './print-sheet'

const PT_PER_MM = 72 / 25.4

async function panel(width: number, height: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer()
}

/** Every page content stream, decompressed, as text. */
function pageContent(pdf: PDFDocument): string {
  const contents = pdf.getPage(0).node.Contents()
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => pdf.context.lookup(ref))
    : [contents]
  return streams
    .map((stream) => {
      const raw = stream as PDFRawStream
      const bytes = Buffer.from(raw.getContents())
      return raw.dict.get(PDFName.of('Filter')) ? inflateSync(bytes).toString('latin1') : bytes.toString('latin1')
    })
    .join('\n')
}

function imageObjectCount(pdf: PDFDocument): number {
  return pdf.context
    .enumerateIndirectObjects()
    .filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    .length
}

/** The translations applied before each image is drawn: `1 0 0 1 x y cm`. */
function translations(content: string): Array<{ x: number; y: number }> {
  return [...content.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
}

describe('buildTableTalkerSheetPdf', () => {
  it('draws one embedded panel three times on an A4 landscape page', async () => {
    const image = await panel(600, 1273)
    const { bytes, layout } = await buildTableTalkerSheetPdf({
      image,
      format: 'png',
      eventName: 'Quiz Night',
    })

    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    const { width, height } = pdf.getPage(0).getSize()
    expect(width).toBeCloseTo(SHEET_WIDTH_MM * PT_PER_MM, 2)
    expect(height).toBeCloseTo(SHEET_HEIGHT_MM * PT_PER_MM, 2)
    expect(width).toBeCloseTo(841.89, 1)
    expect(height).toBeCloseTo(595.28, 1)

    // Embedded once, drawn three times: the sheet stays about the size of one panel.
    expect(imageObjectCount(pdf)).toBe(1)
    const content = pageContent(pdf)
    expect(content.match(/ Do\b/g)).toHaveLength(3)

    // Each draw starts at its artwork rect's bottom-left corner, in points.
    const placed = translations(content)
    for (const rect of layout.artwork) {
      const x = rect.x * PT_PER_MM
      const y = (SHEET_HEIGHT_MM - rect.y - rect.height) * PT_PER_MM
      expect(placed.some((p) => Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01)).toBe(true)
    }
  })

  it('draws the 24 crop marks as hairlines', async () => {
    const { bytes } = await buildTableTalkerSheetPdf({
      image: await panel(600, 1273),
      format: 'png',
      eventName: 'Quiz Night',
    })
    const content = pageContent(await PDFDocument.load(bytes))
    // One stroke per mark.
    expect(content.match(/\bS\b/g)).toHaveLength(24)
    expect(content).toContain('0.25 w')
  })

  it('names the event in the title and asks for actual size printing', async () => {
    const { bytes } = await buildTableTalkerSheetPdf({
      image: await panel(600, 1273),
      format: 'png',
      eventName: 'Quiz Night',
    })
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(pdf.getTitle()).toBe('Table talkers: Quiz Night')
    expect(pdf.catalog.getViewerPreferences()?.getPrintScaling()).toBe(PrintScaling.None)
  })

  it('fits the sheet to the pixels it embedded, and reports the print resolution', async () => {
    const { layout } = await buildTableTalkerSheetPdf({
      image: await panel(1169, 2480),
      format: 'png',
      eventName: 'Quiz Night',
    })
    expect(layout.dpi).toBeCloseTo(321.6, 1)
    const small = await buildTableTalkerSheetPdf({ image: await panel(500, 1061), format: 'png', eventName: 'Quiz Night' })
    expect(small.layout.dpi).toBeLessThan(150)
  })

  it('takes a JPEG panel as well as a PNG one', async () => {
    const { bytes } = await buildTableTalkerSheetPdf({
      image: await panel(600, 1273, 'jpeg'),
      format: 'jpeg',
      eventName: 'Quiz Night',
    })
    expect(imageObjectCount(await PDFDocument.load(bytes))).toBe(1)
  })
})

describe('sniffSheetImageFormat', () => {
  it('reads the format from the bytes, not the name', async () => {
    expect(sniffSheetImageFormat(await panel(10, 21))).toBe('png')
    expect(sniffSheetImageFormat(await panel(10, 21, 'jpeg'))).toBe('jpeg')
    expect(sniffSheetImageFormat(await sharp({ create: { width: 10, height: 21, channels: 3, background: '#fff' } }).webp().toBuffer())).toBeNull()
    expect(sniffSheetImageFormat(Buffer.from('%PDF-1.7'))).toBeNull()
    expect(sniffSheetImageFormat(Buffer.alloc(0))).toBeNull()
  })
})
