import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import EventCheckInClient from './EventCheckInClient'

type PageProps = {
  params: Promise<{ id: string }>
}

type EventRecord = {
  id: string
  name: string
  date: string
  time: string
  category?: {
    name: string
    color: string | null
  } | null
}

export const dynamic = 'force-dynamic'

export default async function EventCheckInPage({ params }: PageProps) {
  const { id } = await params
  const permissionsResult = await getCurrentUserModuleActions('events')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  if (!permissionsResult.actions.includes('manage')) {
    redirect('/unauthorized')
  }

  const supabase = createAdminClient()
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, date, time, category:event_categories(name, color)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Failed to load event for check-in:', error)
  }

  if (!event) {
    notFound()
  }

  const normalizedEvent: EventRecord = {
    id: event.id,
    name: event.name,
    date: event.date,
    time: event.time,
    category: Array.isArray(event.category) ? event.category[0] : event.category,
  }

  return <EventCheckInClient event={normalizedEvent} />
}
