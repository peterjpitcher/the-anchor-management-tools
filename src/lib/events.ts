import { createClient } from '@/lib/supabase/server'
import { cache } from './cache'
import { logger } from './logger'
import { getTodayIsoDate, getLocalIsoDateDaysAhead } from './dateUtils'

/**
 * Get available capacity for an event with caching
 */
export async function getEventAvailableCapacity(eventId: string): Promise<number | null> {
  const cacheKey = cache.buildKey('CAPACITY', eventId)

  return cache.getOrSet(
    cacheKey,
    async () => {
      const supabase = await createClient()

      // Get event details
      const { data: event } = await supabase
        .from('events')
        .select('capacity')
        .eq('id', eventId)
        .single()

      if (!event) return null
      if (event.capacity === null) return null

      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('seats')
        .eq('event_id', eventId)

      if (bookingsError) {
        logger.error('Failed to calculate booking sum', { error: bookingsError, metadata: { eventId } })
        return null
      }

      const bookedSeats = bookings?.reduce((sum, booking) => sum + (booking.seats || 0), 0) ?? 0
      const available = (event.capacity || 0) - bookedSeats

      logger.debug('Calculated event capacity', {
        metadata: { eventId, capacity: event.capacity, booked: bookedSeats, available }
      })

      return available
    },
    'SHORT' // Cache for 1 minute
  )
}

/**
 * Get event details with caching
 */
export async function getEventDetails(eventId: string) {
  const cacheKey = cache.buildKey('EVENT', eventId)

  return cache.getOrSet(
    cacheKey,
    async () => {
      const supabase = await createClient()

      const { data: event, error } = await supabase
        .from('events')
        .select(`
          *,
          category:event_categories(id, name, standardized_name),
          bookings(count)
        `)
        .eq('id', eventId)
        .single()

      if (error) {
        logger.error('Failed to fetch event details', {
          error,
          metadata: { eventId }
        })
        throw error
      }

      return event
    },
    'MEDIUM' // Cache for 5 minutes
  )
}

/**
 * Get upcoming events with caching
 */
export async function getUpcomingEvents(days: number = 7) {
  const cacheKey = cache.buildKey('EVENT', 'upcoming', days)

  return cache.getOrSet(
    cacheKey,
    async () => {
      const supabase = await createClient()

      const startDateIso = getTodayIsoDate()
      const endDateIso = getLocalIsoDateDaysAhead(days)

      const { data: events, error } = await supabase
        .from('events')
        .select(`
          *,
          category:event_categories(id, name),
          bookings(count)
        `)
        .gte('date', startDateIso)
        .lte('date', endDateIso)
        .order('date', { ascending: true })
        .order('time', { ascending: true })

      if (error) {
        logger.error('Failed to fetch upcoming events', {
          error,
          metadata: { days }
        })
        throw error
      }

      return events
    },
    'LONG' // Cache for 1 hour
  )
}

/**
 * Invalidate event-related caches when data changes
 */
export async function invalidateEventCache(eventId?: string) {
  if (eventId) {
    await cache.delete(cache.buildKey('EVENT', eventId))
    await cache.delete(cache.buildKey('CAPACITY', eventId))
  }

  // Always invalidate listings
  await cache.flush('EVENT')
  await cache.flush('CAPACITY')
}
