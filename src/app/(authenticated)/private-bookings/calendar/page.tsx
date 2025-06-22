import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import CalendarView from '@/components/private-bookings/CalendarView'

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-4">
            <Link
              href="/private-bookings"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Private Bookings Calendar</h1>
              <p className="text-gray-600 mt-1">View all bookings in calendar format</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CalendarView bookings={bookings || []} />
      </div>
    </div>
  )
}