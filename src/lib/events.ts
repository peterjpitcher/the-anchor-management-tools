import { createClient } from '@/lib/supabase/server'
import { cache } from './cache'
import { logger } from './logger'

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
      
      if (!event || !event.capacity) {
        return null
      }
      
      // Get current bookings
      const { data: bookings } = await supabase
        .from('bookings')
        .select('seats')
        .eq('event_id', eventId)
      
      const bookedSeats = bookings?.reduce((sum, b) => sum + (b.seats || 0), 0) || 0
      const available = event.capacity - bookedSeats
      
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
      
      const startDate = new Date()
      const endDate = new Date()
      endDate.setDate(endDate.getDate() + days)
      
      const { data: events, error } = await supabase
        .from('events')
        .select(`
          *,
          category:event_categories(id, name),
          bookings(count)
        `)
        .gte('date', startDate.toISOString().split('T')[0])
        .lte('date', endDate.toISOString().split('T')[0])
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