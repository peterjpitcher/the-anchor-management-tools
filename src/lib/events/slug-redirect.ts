import type { SupabaseClient } from '@supabase/supabase-js'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'

/**
 * Where an old event web address should send a guest now (BK-192). Addresses change when a date
 * moves or staff rewrite them, and old links, posters and short links used to land on 'not found'.
 *
 * - renamed: event_slug_history knows the event, which now lives at another address.
 * - next_in_series: the event is gone, so the next upcoming night whose address shares the old
 *   one's name (the part before its date) is offered instead.
 *
 * Returns null when there is nothing better to offer, or when a read fails: the caller then
 * answers 'not found' as before, which is never worse than today.
 */
export type MovedEventSlug = { slug: string; reason: 'renamed' | 'next_in_series' }

const SLUG_PATTERN = /^[a-z0-9-]+$/

/** The name part of an event address: 'quiz-night-2026-09-16' gives 'quiz-night'. */
export function eventSlugStem(slug: string): string | null {
  const stem = slug.toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{4}$/, '').replace(/-+$/, '')
  if (!SLUG_PATTERN.test(stem) || stem.length < 4) return null
  return stem
}

export async function resolveMovedEventSlug(
  db: SupabaseClient<any, 'public', any>,
  slug: string
): Promise<MovedEventSlug | null> {
  const requested = slug.trim().toLowerCase()
  if (!SLUG_PATTERN.test(requested)) return null
  try {
    const { data: history, error: historyError } = await db
      .from('event_slug_history')
      .select('event_id')
      .eq('old_slug', requested)
      .maybeSingle()
    if (historyError) throw historyError
    const eventId = (history as { event_id?: string | null } | null)?.event_id ?? null
    if (eventId) {
      const { data: current, error: currentError } = await db
        .from('events')
        .select('slug')
        .eq('id', eventId)
        .maybeSingle()
      if (currentError) throw currentError
      const currentSlug = (current as { slug?: string | null } | null)?.slug ?? null
      if (currentSlug && currentSlug !== requested) return { slug: currentSlug, reason: 'renamed' }
    }

    const stem = eventSlugStem(requested)
    if (!stem) return null
    const { data: next, error: nextError } = await db
      .from('events')
      .select('slug, date')
      .ilike('slug', `%${stem}%`)
      .gte('date', getTodayIsoDate())
      .not('event_status', 'in', '(cancelled,draft)')
      .order('date', { ascending: true })
      .limit(1)
    if (nextError) throw nextError
    const nextSlug = (next?.[0] as { slug?: string | null } | undefined)?.slug ?? null
    if (nextSlug && nextSlug !== requested) return { slug: nextSlug, reason: 'next_in_series' }
    return null
  } catch (error) {
    logger.warn('Could not resolve an old event address', {
      metadata: { slug: requested, error: error instanceof Error ? error.message : String(error) },
    })
    return null
  }
}
