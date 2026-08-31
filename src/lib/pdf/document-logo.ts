/**
 * The company logo, read from the deployment bundle and inlined as a data URI.
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

const LOGO_RELATIVE_PATH = 'public/logo-oj.jpg'

let cached: string | null | undefined

export function getDocumentLogoDataUri(): string | undefined {
  // `undefined` means not yet attempted, `null` means attempted and unavailable.
  // Distinguishing them stops a missing file being re-read on every render.
  if (cached !== undefined) return cached ?? undefined

  try {
    const file = path.join(process.cwd(), LOGO_RELATIVE_PATH)
    const bytes = fs.readFileSync(file)
    cached = `data:image/jpeg;base64,${bytes.toString('base64')}`
  } catch (error) {
    console.warn(
      '[pdf] Document logo could not be read, rendering without it:',
      error instanceof Error ? error.message : error
    )
    cached = null
  }

  return cached ?? undefined
}
