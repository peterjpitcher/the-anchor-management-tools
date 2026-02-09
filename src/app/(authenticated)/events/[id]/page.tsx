import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getEventMarketingLinks } from '@/app/actions/event-marketing-links'
import { getEventInterestAudience } from '@/app/actions/event-interest-audience'
import EventDetailClient from './EventDetailClient'
import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'

type EventWithCategory = Event & {
  category?: EventCategory | null
}

export type EventBookingCustomer = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
}

export type EventBookingSummary = {
  id: string
  seats: number | null
  is_reminder_only: boolean
  status: string | null
  source: string | null
  created_at: string
  hold_expires_at: string | null
  cancelled_at: string | null
  customer: EventBookingCustomer | null
}

export const dynamic = 'force-dynamic'

export default async function EventViewPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id: eventId } = await params
  const supabase = await createClient()

  const [eventResult, marketingLinksResult, interestAudienceResult] = await Promise.all([
    supabase
      .from('events')
      .select('*, category:event_categories(*)')
      .eq('id', eventId)
      .single(),
    getEventMarketingLinks(eventId),
    getEventInterestAudience(eventId)
  ])

  const { data: eventData, error: eventError } = eventResult

  if (eventError || !eventData) {
    if (eventError && eventError.code !== 'PGRST116') {
      console.error('Error loading event:', eventError)
    }
    notFound()
  }

  // Cast types and handle nulls
  const event = eventData as EventWithCategory

  const marketingLinks = marketingLinksResult.success ? (marketingLinksResult.links || []) : []
  const interestAudience = interestAudienceResult.success ? (interestAudienceResult.data || null) : null
  const { data: eventBookingsRaw, error: bookingsError } = await supabase
    .from('bookings')
    .select(
      `
      id,
      seats,
      is_reminder_only,
      status,
      source,
      created_at,
      hold_expires_at,
      cancelled_at,
      customer:customers(id, first_name, last_name, mobile_number, mobile_e164)
    `
    )
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })

  if (bookingsError) {
    console.error('Error loading event bookings:', bookingsError)
  }

  const eventBookings: EventBookingSummary[] = ((eventBookingsRaw || []) as any[]).map((row) => ({
    id: row.id,
    seats: row.seats ?? null,
    is_reminder_only: row.is_reminder_only === true,
    status: row.status ?? null,
    source: row.source ?? null,
    created_at: row.created_at,
    hold_expires_at: row.hold_expires_at ?? null,
    cancelled_at: row.cancelled_at ?? null,
    customer: row.customer
      ? {
          id: row.customer.id,
          first_name: row.customer.first_name ?? null,
          last_name: row.customer.last_name ?? null,
          mobile_number: row.customer.mobile_number ?? null,
          mobile_e164: row.customer.mobile_e164 ?? null
        }
      : null
  }))

  return (
    <EventDetailClient
      event={event}
      initialMarketingLinks={marketingLinks}
      initialBookings={eventBookings}
      initialInterestAudience={interestAudience}
    />
  )
}
