'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'

// Cache events data for 2 minutes
export const getEventsWithBookings = unstable_cache(
  async () => {
    const supabase = createAdminClient()
    
    // Get all events with booking counts in a single query
    const { data: events, error } = await supabase
      .from('events')
      .select(`
        *,
        bookings (id),
        event_category:event_categories(id, name, color, icon)
      `)
      .order('date', { ascending: false })
    
    if (error) {
      console.error('Error fetching events:', error)
      return []
    }
    
    // Transform the data to include booking counts
    return events.map(event => ({
      ...event,
      bookingCount: event.bookings?.length || 0,
      bookings: undefined // Remove the raw bookings array
    }))
  },
  ['events-with-bookings'],
  {
    revalidate: 120, // Cache for 2 minutes
    tags: ['events']
  }
)

// Get a single event with full details
export const getEventDetails = unstable_cache(
  async (eventId: string) => {
    const supabase = createAdminClient()
    
    const { data: event, error } = await supabase
      .from('events')
      .select(`
        *,
        event_category:event_categories(*),
        bookings (
          id,
          created_at,
          customer:customers(id, first_name, last_name, mobile_number)
        ),
        event_message_templates (
          id,
          template_type,
          custom_content,
          is_active
        )
      `)
      .eq('id', eventId)
      .single()
    
    if (error) {
      console.error('Error fetching event:', error)
      return null
    }
    
    return event
  },
  ['event-details'],
  {
    revalidate: 60, // Cache for 1 minute
    tags: ['events', 'event-details']
  }
)

// Invalidate cache when events are updated
export async function invalidateEventsCache() {
  const { revalidateTag } = await import('next/cache')
  revalidateTag('events')
}

export async function invalidateEventCache(_eventId: string) {
  const { revalidateTag } = await import('next/cache')
  revalidateTag('events')
  revalidateTag('event-details')
}