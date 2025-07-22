import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CalendarView from '@/components/private-bookings/CalendarView'
import { Page } from '@/components/ui-v2/layout/Page'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'

export default async function PrivateBookingsCalendarPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Check permissions
  const { data: hasViewPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'view'
  })

  if (!hasViewPermission) {
    redirect('/unauthorized')
  }

  // Fetch all bookings for the calendar
  const { data: bookings, error } = await supabase
    .from('private_bookings')
    .select(`
      id,
      customer_name,
      event_date,
      start_time,
      end_time,
      status,
      event_type,
      guest_count
    `)
    .order('event_date', { ascending: true })

  if (error) {
    console.error('Error fetching bookings:', error)
  }

  return (
    <Page
      title="Private Bookings Calendar"
      description="View all bookings in calendar format"
      actions={
        <LinkButton href="/private-bookings" variant="secondary">Back</LinkButton>
      }
    >
      <CalendarView bookings={bookings || []} />
    </Page>
  )
}