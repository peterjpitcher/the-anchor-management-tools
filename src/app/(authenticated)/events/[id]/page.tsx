import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEventMarketingLinks, generateEventMarketingLinks, type EventMarketingLink } from '@/app/actions/event-marketing-links'
import { EVENT_MARKETING_CHANNELS } from '@/lib/event-marketing-links'
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
  const canView = await checkUserPermission('events', 'view')
  if (!canView) redirect('/unauthorized')

  const { id: eventId } = await params
  const supabase = await createClient()

  const [eventResult, marketingLinksResult] = await Promise.all([
    supabase
      .from('events')
      .select('*, category:event_categories(*)')
      .eq('id', eventId)
      .single(),
    getEventMarketingLinks(eventId)
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

  let marketingLinks: EventMarketingLink[] = marketingLinksResult.success
    ? (marketingLinksResult.links || [])
    : []

  const alwaysOnKeys = EVENT_MARKETING_CHANNELS
    .filter(c => c.tier === 'always_on')
    .map(c => c.key)

  const existingKeys = marketingLinks.map(l => l.channel)
  const missingAlwaysOn = alwaysOnKeys.some(k => !existingKeys.includes(k))

  if (missingAlwaysOn) {
    await generateEventMarketingLinks(eventId)
    const refreshed = await getEventMarketingLinks(eventId)
    marketingLinks = refreshed.success ? (refreshed.links || []) : marketingLinks
  }

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
    />
  )
}
