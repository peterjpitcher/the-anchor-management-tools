import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { Alert } from '@/ds'
import { KioskShell } from '@/components/shells/KioskShell'
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

  // A failed load says so instead of showing the page as not found.
  if (error) {
    console.error('Failed to load event for check-in:', error)
    return (
      <KioskShell title="Event Check-In" width="narrow">
        <Alert tone="danger" title="Could not load this event">
          Refresh the page to try again.
        </Alert>
      </KioskShell>
    )
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
