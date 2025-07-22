import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import EventsClient from './EventsClient'

async function getEvents() {
  const supabase = getSupabaseAdminClient()
  
  const { data: events, error } = await supabase
    .from('events')
    .select(`
      *,
      category:event_categories(*),
      bookings (id, seats)
    `)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
  
  if (error) {
    console.error('Error fetching events:', error)
    return []
  }
  
  return events.map(event => ({
    ...event,
    booked_seats: event.bookings?.reduce((sum: number, booking: any) => sum + (booking.seats || 0), 0) || 0,
    bookings: undefined
  }))
}

export default async function EventsPage() {
  const events = await getEvents()
  
  return <EventsClient events={events} />
}