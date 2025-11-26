import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getEventMarketingLinks } from '@/app/actions/event-marketing-links'
import EventDetailClient, { EventCheckInRecord } from './EventDetailClient'
import { Event, Booking, Customer } from '@/types/database'
import { EventCategory } from '@/types/event-categories'

type EventWithCategory = Event & {
  category?: EventCategory | null
}

type BookingWithCustomer = Omit<Booking, 'customer'> & {
  customer: Pick<Customer, 'first_name' | 'last_name' | 'id'>
}

export const dynamic = 'force-dynamic'

export default async function EventViewPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const { id: eventId } = await params
  const supabase = await createClient()

  const [
    eventResult,
    bookingsResult,
    checkInsResult,
    marketingLinksResult
  ] = await Promise.all([
    supabase
      .from('events')
      .select('*, category:event_categories(*)')
      .eq('id', eventId)
      .single(),
    supabase
      .from('bookings')
      .select('id, event_id, customer_id, seats, is_reminder_only, notes, created_at, customer:customers!inner(id, first_name, last_name)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true }),
    supabase
      .from('event_check_ins')
      .select('id, check_in_time, check_in_method, customer:customers!inner(id, first_name, last_name, mobile_number)')
      .eq('event_id', eventId)
      .order('check_in_time', { ascending: false }),
    getEventMarketingLinks(eventId)
  ])

  const { data: eventData, error: eventError } = eventResult
  const { data: bookingsData, error: bookingsError } = bookingsResult
  const { data: checkInsData, error: checkInsError } = checkInsResult

  if (eventError || !eventData) {
    if (eventError && eventError.code !== 'PGRST116') {
       console.error('Error loading event:', eventError)
    }
    notFound()
  }

  if (bookingsError) {
    console.error('Error loading bookings:', bookingsError)
  }

  if (checkInsError) {
    console.error('Error loading check-ins:', checkInsError)
  }

  // Cast types and handle nulls
  const event = eventData as EventWithCategory
  const bookings = (bookingsData || []).map((booking: any) => ({
    ...booking,
    customer: Array.isArray(booking.customer) ? booking.customer[0] : booking.customer
  })) as BookingWithCustomer[]
  // Transform check-ins to match the expected type (specifically handling potentially null fields from join)
  const checkIns = (checkInsData || []).map((record: any) => ({
    id: record.id,
    check_in_time: record.check_in_time,
    check_in_method: record.check_in_method,
    customer: {
      id: record.customer.id,
      first_name: record.customer.first_name,
      last_name: record.customer.last_name,
      mobile_number: record.customer.mobile_number
    }
  })) as EventCheckInRecord[]

  const marketingLinks = marketingLinksResult.success ? (marketingLinksResult.links || []) : []

  return (
    <EventDetailClient
      event={event}
      bookings={bookings}
      checkIns={checkIns}
      initialMarketingLinks={marketingLinks}
    />
  )
}
