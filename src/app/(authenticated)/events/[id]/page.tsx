import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getEventMarketingLinks } from '@/app/actions/event-marketing-links'
import EventDetailClient from './EventDetailClient'
import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'

type EventWithCategory = Event & {
  category?: EventCategory | null
}

export const dynamic = 'force-dynamic'

export default async function EventViewPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
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

  const marketingLinks = marketingLinksResult.success ? (marketingLinksResult.links || []) : []

  return (
    <EventDetailClient
      event={event}
      initialMarketingLinks={marketingLinks}
    />
  )
}
