import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import LegacyLinkClient from './LegacyLinkClient'

const FALLBACK_REDIRECT_URL = 'https://www.the-anchor.pub'

type PageProps = {
  params: Promise<{ code: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function normalizeShortCode(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const normalized = decodeURIComponent(raw).trim().toLowerCase()
    return /^[a-z0-9-]{1,20}$/.test(normalized) ? normalized : null
  } catch {
    return null
  }
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return raw ? raw : null
}

/**
 * Interstitial shown only for legacy vip-club.uk traffic.
 *
 * The click has already been recorded by /api/redirect/[code] before this renders, so
 * this page never writes a click of its own. It resolves the destination purely to
 * offer the onward link.
 */
export default async function LegacyLinkPage({ params, searchParams }: PageProps) {
  const { code } = await params
  const query = searchParams ? await searchParams : {}
  const shortCode = normalizeShortCode(code)

  if (!shortCode) redirect(FALLBACK_REDIRECT_URL)

  const supabase = createAdminClient()

  const { data: link } = await supabase
    .from('short_links')
    .select('id, short_code, destination_url')
    .eq('short_code', shortCode)
    .maybeSingle()

  let destinationUrl: string | null = link?.destination_url ?? null

  if (!destinationUrl) {
    const { data: alias } = await supabase
      .from('short_link_aliases')
      .select('short_link_id')
      .eq('alias_code', shortCode)
      .maybeSingle()

    if (alias?.short_link_id) {
      const { data: target } = await supabase
        .from('short_links')
        .select('destination_url')
        .eq('id', alias.short_link_id)
        .maybeSingle()
      destinationUrl = target?.destination_url ?? null
    }
  }

  if (!destinationUrl) redirect(FALLBACK_REDIRECT_URL)

  // The redirect handler passes the destination it actually resolved, which may carry
  // tracking params or a reissued token. Only same-origin-safe http(s) values are honoured.
  const passedDestination = firstParam(query.to)
  let finalDestination = destinationUrl
  if (passedDestination) {
    try {
      const parsed = new URL(passedDestination)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        finalDestination = parsed.toString()
      }
    } catch {
      // Keep the resolved destination.
    }
  }

  return (
    <LegacyLinkClient
      shortCode={shortCode}
      destinationUrl={finalDestination}
      staffMode={firstParam(query.staff) === '1'}
    />
  )
}
