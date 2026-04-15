import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { EventCategory } from '@/types/event-categories'
import BulkMessagesClient from './BulkMessagesClient'

export const metadata = {
  title: 'Bulk Messages | The Anchor',
}

interface EventOption {
  id: string
  name: string
  date: string
}

export default async function BulkMessagesPage() {
  const canSendMessages = await checkUserPermission('messages', 'send')
  if (!canSendMessages) {
    redirect('/unauthorized')
  }

  const supabase = await createClient()

  const { data: eventsData, error: eventsError } = await supabase
    .from('events')
    .select('id, name, date')
    .order('date', { ascending: true })
    .limit(500)

  if (eventsError) {
    console.error('Error loading events:', eventsError)
  }

  const categoriesResult = await getActiveEventCategories()
  if (categoriesResult.error) {
    console.error('Error loading event categories:', categoriesResult.error)
  }

  const events: EventOption[] = eventsData || []
  const categories: EventCategory[] = (categoriesResult.data as EventCategory[]) || []

  return (
    <BulkMessagesClient
      events={events}
      categories={categories}
    />
  )
}
