import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { redirect, notFound } from 'next/navigation'
import { EventCategory } from '@/types/event-categories'
import EditEventClient from './EditEventClient'

interface PageProps {
  params: Promise<{ id: string }>
}

export const maxDuration = 60

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

  // Load event, categories, and active booking count in parallel
  const [eventResult, categoriesResult, bookingCountResult] = await Promise.all([
    supabase
      .from('events')
      .select('*, event_faqs(id, question, answer, sort_order)')
      .eq('id', id)
      .single(),
    getActiveEventCategories(),
    supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id)
      .in('status', ['confirmed', 'pending_payment'])
  ])

  if (eventResult.error || !eventResult.data) {
    if (eventResult.error?.code !== 'PGRST116') {
      console.error('Error loading event for edit:', eventResult.error)
    }
    return notFound()
  }

  if (categoriesResult.error) {
    console.error('Error loading event categories:', categoriesResult.error)
  }

  const activeBookingCount = bookingCountResult.count ?? 0

  return (
    <EditEventClient
      event={eventResult.data}
      categories={(categoriesResult.data as EventCategory[]) || []}
      activeBookingCount={activeBookingCount}
    />
  )
}
