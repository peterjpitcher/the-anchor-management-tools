import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'

/** Width and height from a PNG's IHDR chunk, which always starts at byte 16. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(path.join(process.cwd(), file))
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('getDocumentLogoDataUri', () => {
  it('inlines the Orange Jelly wordmark, not the retired round badge', () => {
    const uri = getDocumentLogoDataUri()
    const committed = fs.readFileSync(path.join(process.cwd(), 'public/orange-jelly/logo-horizontal-document.png'))

    expect(uri).toBe(`data:image/png;base64,${committed.toString('base64')}`)
  })

  it('keeps the document copy the same shape as the supplied logo', () => {
    // The copy is rebuilt by hand from logo-horizontal.png. A new logo with a stale copy would
    // print the old artwork on every invoice; a different shape is the cheapest sign of that.
    expect(pngSize('public/orange-jelly/logo-horizontal-document.png')).toEqual(
      pngSize('public/orange-jelly/logo-horizontal.png')
    )
  })
})
