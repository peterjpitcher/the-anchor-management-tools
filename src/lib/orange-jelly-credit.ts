/**
 * The "Built and maintained by Orange Jelly" line under the sign-in card.
 *
 * orangejelly.co.uk owns the wording and the link (src/lib/client-credits.ts in that
 * repo) and publishes them per site. This reads that feed on the server and caches it
 * for a day, so a change there reaches the sign-in pages without a release here.
 *
 * It never fails the page. If the feed is unreachable, slow, malformed, or links
 * anywhere except orangejelly.co.uk, the page shows FALLBACK_CREDIT, so the line
 * cannot disappear and the feed can never place a foreign link on this site.
 *
 * Reference copy: docs/credit/README.md in the orangejelly.co.uk repo.
 */

export const ORANGE_JELLY_CREDIT_SITE = 'management-tools'

const ALLOWED_ORIGIN = 'https://www.orangejelly.co.uk'
const FEED_URL = `${ALLOWED_ORIGIN}/api/credit/${ORANGE_JELLY_CREDIT_SITE}`
const REVALIDATE_SECONDS = 60 * 60 * 24
const TIMEOUT_MS = 3000
const MAX_TEXT_LENGTH = 80

export interface OrangeJellyCreditContent {
  /** Text before the link. May be empty. */
  prefix: string
  label: string
  href: string
  rel?: 'nofollow'
}

export const FALLBACK_CREDIT: OrangeJellyCreditContent = {
  prefix: 'Built and maintained by',
  label: 'Orange Jelly',
  href: `${ALLOWED_ORIGIN}/`,
}

/** The feed's answer as renderable content, or null when it is anything unexpected. */
export function parseOrangeJellyCredit(data: unknown): OrangeJellyCreditContent | null {
  if (!data || typeof data !== 'object') return null
  const { prefix, label, href, nofollow } = data as Record<string, unknown>

  if (typeof prefix !== 'string' || prefix.length > MAX_TEXT_LENGTH) return null
  if (typeof label !== 'string' || !label.trim() || label.length > MAX_TEXT_LENGTH) return null
  if (typeof href !== 'string') return null

  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.origin !== ALLOWED_ORIGIN || url.username || url.password) return null

  return {
    prefix: prefix.trim(),
    label: label.trim(),
    href: url.toString(),
    ...(nofollow === true ? { rel: 'nofollow' as const } : {}),
  }
}

export async function getOrangeJellyCredit(): Promise<OrangeJellyCreditContent> {
  try {
    const response = await fetch(FEED_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`feed answered ${response.status}`)

    const credit = parseOrangeJellyCredit(await response.json())
    if (!credit) throw new Error('feed answered with an unexpected shape')
    return credit
  } catch (error) {
    // Next.js signals dynamic rendering and redirects by throwing errors that carry a
    // digest. Those are not feed failures and must reach the framework.
    if (error && typeof error === 'object' && 'digest' in error) throw error
    console.warn('[orange-jelly-credit] showing the fallback line:', error)
    return FALLBACK_CREDIT
  }
}
