import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/lib/logger'

const EVENT_PAGE = /^https?:\/\/[^/]+\/events\/([^/?#]+)/i

/** The event slugs a campaign's links point at, each once, in a stable order. */
export function eventSlugsIn(urls: readonly string[]): string[] {
  const slugs = new Set<string>()
  for (const url of urls) {
    const match = EVENT_PAGE.exec(url)
    if (match) slugs.add(decodeURIComponent(match[1]).toLowerCase())
  }
  return [...slugs].sort()
}

/**
 * The one event a campaign promotes, or null.
 *
 * An event email links to that event's page; a monthly round-up links to several. Only the
 * first kind has an answer, and `claim_marketing_recipients` uses it to leave out a guest who
 * has already booked. Anything else (no event link, two events, a slug we do not know) is
 * null, which sends to everyone exactly as before.
 *
 * Never throws: failing to work this out must not stop a campaign being scheduled. It is
 * logged as an error because the cost is real, a booked guest being asked to book.
 */
export async function resolvePromotedEventId(
  supabase: SupabaseClient<any, 'public', any>,
  urls: readonly string[],
): Promise<string | null> {
  const slugs = eventSlugsIn(urls)
  if (slugs.length === 0) return null

  try {
    const { data, error } = await supabase.from('events').select('id').in('slug', slugs)
    if (error) throw new Error(error.message)
    const ids = [...new Set((data ?? []).map((row: { id: string }) => row.id))]
    return ids.length === 1 ? ids[0] : null
  } catch (error) {
    logger.error('Could not work out which event a campaign promotes, so booked guests are not skipped', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { slugs },
    })
    return null
  }
}
