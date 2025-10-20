import { redirect } from 'next/navigation'
import CalendarView from '@/components/private-bookings/CalendarView'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission } from '@/app/actions/rbac'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'

export default async function PrivateBookingsCalendarPage() {
  const canView = await checkUserPermission('private_bookings', 'view')

  if (!canView) {
    redirect('/unauthorized')
  }

  const result = await fetchPrivateBookingsForCalendar()

  if ('error' in result) {
    throw new Error(result.error)
  }

  return (
    <PageLayout
      title="Private Bookings Calendar"
      subtitle="View all bookings in calendar format"
      backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
    >
      <div className="space-y-6">
        <CalendarView bookings={result.data} />
      </div>
    </PageLayout>
  )
}
