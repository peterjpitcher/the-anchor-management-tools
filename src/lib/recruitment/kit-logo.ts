import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Anchor logo for the recruitment PDFs, as a data URI.
 *
 * These documents used to reference the logo over HTTP. The URL itself is fine,
 * but a headless Chrome running inside a serverless function fetching its own
 * public hostname is one more thing that can fail, and when it did the PDFs went
 * out with a broken-image icon and the alt text where the logo should be. Reading
 * the file off disk removes the network from the path entirely.
 *
 * Falls back to the absolute URL if the file cannot be read, so a tracing miss
 * degrades to the old behaviour rather than throwing.
 */

const LOGO_RELATIVE_PATH = join('public', 'booking-confirmation', 'anchor-logo-black.png')

let cached: string | null = null

export function recruitmentKitLogoSrc(fallbackUrl: string): string {
  if (cached) return cached
  try {
    const bytes = readFileSync(join(process.cwd(), LOGO_RELATIVE_PATH))
    cached = `data:image/png;base64,${bytes.toString('base64')}`
    return cached
  } catch (error) {
    console.warn('[recruitment kit] logo could not be inlined, falling back to URL:', error)
    return fallbackUrl
  }
}
