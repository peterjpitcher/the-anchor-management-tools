/**
 * The company logo, read from the deployment bundle and inlined as a data URI.
 *
 * Invoices and quotes point the renderer at `${NEXT_PUBLIC_APP_URL}/logo-oj.jpg`
 * and let Chromium fetch it. That makes PDF generation depend on the server
 * reaching its own public URL: it silently produces an unbranded document when
 * the variable is unset, and can stall on `networkidle0` during a domain or
 * deployment incident.
 *
 * Statements read the file instead, so rendering a customer document never
 * depends on the network. Behaviour when the asset cannot be read matches the
 * existing templates: the document renders without a logo rather than failing.
 */

import fs from 'fs'
import path from 'path'

const LOGO_RELATIVE_PATH = 'public/logo-oj.jpg'

let cached: string | null | undefined

export function getStatementLogoDataUri(): string | undefined {
  // `undefined` means not yet attempted, `null` means attempted and unavailable.
  // Distinguishing them stops a missing file being re-read on every render.
  if (cached !== undefined) return cached ?? undefined

  try {
    const file = path.join(process.cwd(), LOGO_RELATIVE_PATH)
    const bytes = fs.readFileSync(file)
    cached = `data:image/jpeg;base64,${bytes.toString('base64')}`
  } catch (error) {
    console.warn(
      '[pdf] Statement logo could not be read, rendering without it:',
      error instanceof Error ? error.message : error
    )
    cached = null
  }

  return cached ?? undefined
}
