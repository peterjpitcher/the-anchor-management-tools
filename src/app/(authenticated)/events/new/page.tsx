import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { redirect } from 'next/navigation'
import { EventCategory } from '@/types/event-categories'
import NewEventClient from './NewEventClient'

export const metadata = {
  title: 'Create New Event',
}

export default async function NewEventPage() {
  const canManageEvents = await checkUserPermission('events', 'manage')
  if (!canManageEvents) {
    redirect('/unauthorized')
  }

  const supabase = await createClient()
  const { data: categories } = await supabase
    .from('event_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')

  return (
    <NewEventClient
      categories={(categories as unknown as EventCategory[]) || []}
    />
  )
}
