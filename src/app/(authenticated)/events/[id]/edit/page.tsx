import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { redirect, notFound } from 'next/navigation'
import { EventCategory } from '@/types/event-categories'
import EditEventClient from './EditEventClient'

interface PageProps {
  params: Promise<{ id: string }>
}

export const metadata = {
  title: 'Edit Event',
}

export default async function EditEventPage({ params }: PageProps) {
  const { id } = await params

  const canManageEvents = await checkUserPermission('events', 'manage')
  if (!canManageEvents) {
    redirect('/unauthorized')
  }

  const supabase = await createClient()

  // Load event and categories in parallel
  const [eventResult, categoriesResult] = await Promise.all([
    supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single(),
    supabase
      .from('event_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
  ])

  if (eventResult.error || !eventResult.data) {
    if (eventResult.error?.code !== 'PGRST116') {
      console.error('Error loading event for edit:', eventResult.error)
    }
    return notFound()
  }

  return (
    <EditEventClient
      event={eventResult.data}
      categories={(categoriesResult.data as unknown as EventCategory[]) || []}
    />
  )
}
