/**
 * The Orange Jelly logo, read from the deployment bundle and inlined as a data URI.
 *
 * It is the horizontal wordmark from the owner's design pack (20 Sep 2026), the one the sign-in
 * page shows. It is about 4.6 times wider than it is tall, so templates size it by width or by a
 * modest height; the round "OJ" badge it replaced was nearly square.
 *
 * Documents read their own copy, logo-horizontal-document.png: the supplied artwork at the same
 * 1200 by 260 pixels, reduced to 64 colours. Chromium re-encodes an image when it writes a PDF,
 * and the faint texture in the supplied file made it add about 180KB to every invoice. This copy
 * adds about 35KB, a little less than the old badge did, and looks the same on paper. Rebuild it
 * whenever logo-horizontal.png changes (tests/lib/pdf/documentLogo.test.ts checks the shape):
 *
 *   sharp('public/orange-jelly/logo-horizontal.png')
 *     .png({ palette: true, colours: 64, dither: 0, compressionLevel: 9, effort: 10 })
 *     .toFile('public/orange-jelly/logo-horizontal-document.png')
 *
 * Invoices and quotes used to point the renderer at
 * `${NEXT_PUBLIC_APP_URL}/logo-oj.jpg` and let Chromium fetch it over the
 * network. That made PDF generation depend on the server reaching its own
 * public URL from inside a serverless function, which produced an unbranded
 * invoice whenever that fetch did not complete, and could stall the
 * `networkidle0` wait during a domain or deployment incident. The failure was
 * silent: the template simply omits the `<img>` and renders on.
 *
 * Reading the file instead means rendering a customer document never depends
 * on the network at all. Behaviour when the asset cannot be read is unchanged:
 * the document renders without a logo rather than failing.
 */

import fs from 'fs'
import path from 'path'

const LOGO_RELATIVE_PATH = 'public/orange-jelly/logo-horizontal-document.png'

let cached: string | null | undefined

export function getDocumentLogoDataUri(): string | undefined {
  // `undefined` means not yet attempted, `null` means attempted and unavailable.
  // Distinguishing them stops a missing file being re-read on every render.
  if (cached !== undefined) return cached ?? undefined

  try {
    const file = path.join(process.cwd(), LOGO_RELATIVE_PATH)
    const bytes = fs.readFileSync(file)
    cached = `data:image/png;base64,${bytes.toString('base64')}`
  } catch (error) {
    console.warn(
      '[pdf] Document logo could not be read, rendering without it:',
      error instanceof Error ? error.message : error
    )
    cached = null
  }

  return cached ?? undefined
}
