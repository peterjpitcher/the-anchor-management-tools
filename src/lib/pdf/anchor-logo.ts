/**
 * The Anchor logo for venue documents, read from the deployment bundle and inlined as a data URI.
 *
 * The black mark on a transparent background, the same file the recruitment printables and the
 * booking sheets print. It is for documents that belong to the pub rather than to Orange Jelly:
 * the allergen sheets, the event guest list and the private booking staff event sheet
 * (docs/design/brief-the-anchor.md lists them). Orange Jelly documents use
 * getDocumentLogoDataUri in ./document-logo instead.
 *
 * Read from disk for the reason given there: a document must never depend on the server reaching
 * its own public URL. If the file cannot be read the document renders without a logo.
 */

import fs from 'fs'
import path from 'path'

const LOGO_RELATIVE_PATH = 'public/booking-confirmation/anchor-logo-black.png'

/** Width over height of the mark (934 by 421 pixels), for renderers that need both dimensions. */
export const ANCHOR_LOGO_ASPECT_RATIO = 934 / 421

let cached: string | null | undefined

export function getAnchorLogoDataUri(): string | undefined {
  // `undefined` means not yet attempted, `null` means attempted and unavailable.
  if (cached !== undefined) return cached ?? undefined

  try {
    const file = path.join(process.cwd(), LOGO_RELATIVE_PATH)
    const bytes = fs.readFileSync(file)
    cached = `data:image/png;base64,${bytes.toString('base64')}`
  } catch (error) {
    console.warn(
      '[pdf] Anchor logo could not be read, rendering without it:',
      error instanceof Error ? error.message : error
    )
    cached = null
  }

  return cached ?? undefined
}
