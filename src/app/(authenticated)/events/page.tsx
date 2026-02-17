import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  getEventsCommandCenterData,
  type PrivateBookingCalendarOverview,
} from './get-events-command-center'
import KPIHeader from '@/components/events/command-center/KPIHeader'
import CommandCenterShell from '@/components/events/command-center/CommandCenterShell'
import { DATE_TBD_NOTE, PrivateBookingService } from '@/services/private-bookings'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'

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
      <PageLayout
        title="Events Command Center"
        subtitle="Manage upcoming events and clear tasks."
        error={data.error}
      />
    )
  }

  return (
    <PageLayout
      title="Events Command Center"
      subtitle="Manage upcoming events and clear tasks."
      className="bg-gray-50/50"
      padded={false}
      contentClassName="px-4 py-4 md:px-8 md:py-6"
    >
      <div className="flex min-h-[65vh] flex-col gap-6 overflow-hidden">
        <KPIHeader kpis={data.kpis} />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CommandCenterShell
            initialData={{
              ...data,
              privateBookingsForCalendar,
            }}
          />
        </div>
      </div>
    </PageLayout>
  )
}
