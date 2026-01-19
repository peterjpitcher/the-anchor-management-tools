import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  getEventsCommandCenterData,
  type PrivateBookingCalendarOverview,
} from './get-events-command-center'
import KPIHeader from '@/components/events/command-center/KPIHeader'
import CommandCenterShell from '@/components/events/command-center/CommandCenterShell'
import { DATE_TBD_NOTE, PrivateBookingService } from '@/services/private-bookings'

export const metadata = {
  title: 'Events Command Center',
}

export default async function EventsPage() {
  const [canViewEvents, canViewPrivateBookings, canManagePrivateBookings] = await Promise.all([
    checkUserPermission('events', 'view'),
    checkUserPermission('private_bookings', 'view'),
    checkUserPermission('private_bookings', 'manage'),
  ])

  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  const data = await getEventsCommandCenterData()
  let privateBookingsForCalendar: PrivateBookingCalendarOverview[] = []

  if (canViewPrivateBookings || canManagePrivateBookings) {
    try {
      const { data: bookings } = await PrivateBookingService.fetchPrivateBookingsForCalendar()

      privateBookingsForCalendar = (bookings ?? [])
        .filter((booking) => booking.status !== 'cancelled')
        .filter((booking) => !booking.internal_notes?.includes(DATE_TBD_NOTE))
        .map((booking) => ({
          id: booking.id,
          customer_name:
            booking.customer_full_name ||
            booking.customer_name ||
            booking.customer_first_name ||
            'Unknown',
          event_date: booking.event_date,
          start_time: booking.start_time || '00:00',
          end_time: booking.end_time ?? null,
          end_time_next_day: booking.end_time_next_day ?? null,
          status: booking.status,
          event_type: booking.event_type ?? null,
          guest_count: booking.guest_count ?? null,
        }))
    } catch (error) {
      console.error('Error loading private bookings for events calendar', error)
    }
  }

  if (data.error) {
    return (
      <div className="p-8 text-center text-red-600 bg-red-50 rounded-lg border border-red-200 m-8">
        <h2 className="text-lg font-semibold">Error Loading Events</h2>
        <p>{data.error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-gray-50/50 p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Events Command Center</h1>
        <p className="text-sm text-gray-500">Manage upcoming events and clear tasks.</p>
      </div>

      <KPIHeader kpis={data.kpis} />

      <CommandCenterShell
        initialData={{
          ...data,
          privateBookingsForCalendar,
        }}
      />
    </div>
  )
}
