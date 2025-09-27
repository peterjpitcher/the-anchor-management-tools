import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import EventCheckInClient from './EventCheckInClient'

interface EventRecord {
  id: string
  name: string
  date: string
  time: string
  category?: {
    name: string
    color: string
  } | null
}

const GOOGLE_REVIEW_LINK = 'https://vip-club.uk/support-us'

export default async function EventCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = getSupabaseAdminClient()

  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, date, time, category:event_categories(name, color)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Failed to load event for check-in:', error)
  }

  if (!event) {
    return notFound()
  }

  const normalizedEvent: EventRecord = {
    id: event.id,
    name: event.name,
    date: event.date,
    time: event.time,
    category: Array.isArray(event.category) ? event.category[0] : event.category,
  }

  return (
    <EventCheckInClient
      event={normalizedEvent}
      reviewLink={GOOGLE_REVIEW_LINK}
    />
  )
}
