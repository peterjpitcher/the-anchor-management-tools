import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANCHOR_LOGO_ASPECT_RATIO, getAnchorLogoDataUri } from '@/lib/pdf/anchor-logo'
import { DOCUMENT_LOGO_ASPECT_RATIO, getDocumentLogoDataUri } from '@/lib/pdf/document-logo'

const DOCUMENT_COPY = 'public/orange-jelly/logo-horizontal-document.png'
const ANCHOR_LOGO = 'public/booking-confirmation/anchor-logo-black.png'

/** Size and colour type from a PNG's IHDR chunk, which always starts at byte 16. */
function pngHeader(file: string): { width: number; height: number; colourType: number } {
  const bytes = fs.readFileSync(path.join(process.cwd(), file))
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes.readUInt8(25) }
}

function pngSize(file: string): { width: number; height: number } {
  const { width, height } = pngHeader(file)
  return { width, height }
}

describe('getDocumentLogoDataUri', () => {
  it('inlines the Orange Jelly wordmark, not the retired round badge', () => {
    const uri = getDocumentLogoDataUri()
    const committed = fs.readFileSync(path.join(process.cwd(), DOCUMENT_COPY))

    expect(uri).toBe(`data:image/png;base64,${committed.toString('base64')}`)
  })

  it('keeps the document copy the same shape as the supplied logo', () => {
    // The copy is rebuilt by hand from logo-horizontal.png. A new logo with a stale copy would
    // print the old artwork on every invoice; a different shape is the cheapest sign of that.
    expect(pngSize(DOCUMENT_COPY)).toEqual(pngSize('public/orange-jelly/logo-horizontal.png'))
  })

  it('keeps the document copy as full-colour RGBA, which both PDF engines draw correctly', () => {
    // Colour type 6 is RGBA. Type 3 is a palette PNG: pdfkit drew a 4-bit palette copy doubled
    // and discoloured on the claim summary, while Chromium drew the same file perfectly.
    expect(pngHeader(DOCUMENT_COPY).colourType).toBe(6)
  })

  it('reports the proportions pdfkit needs to size the wordmark', () => {
    const { width, height } = pngSize(DOCUMENT_COPY)
    expect(DOCUMENT_LOGO_ASPECT_RATIO).toBeCloseTo(width / height, 6)
  })
})

describe('getAnchorLogoDataUri', () => {
  it('inlines the black Anchor mark for venue documents', () => {
    const committed = fs.readFileSync(path.join(process.cwd(), ANCHOR_LOGO))

    expect(getAnchorLogoDataUri()).toBe(`data:image/png;base64,${committed.toString('base64')}`)
  })

  it('reports the proportions pdfkit needs to size the mark', () => {
    const { width, height } = pngSize(ANCHOR_LOGO)
    expect(ANCHOR_LOGO_ASPECT_RATIO).toBeCloseTo(width / height, 6)
  })
})
