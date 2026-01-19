import { redirect } from 'next/navigation'
import CalendarView from '@/components/private-bookings/CalendarView'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'

export default async function PrivateBookingsCalendarPage() {
  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  const actions = new Set(permissionsResult.actions)
  const canView = actions.has('view') || actions.has('manage')

  if (!canView) {
    redirect('/unauthorized')
  }

  const result = await fetchPrivateBookingsForCalendar()

  if ('error' in result) {
    return (
      <PageLayout
        title="Private Bookings Calendar"
        subtitle="View all bookings in calendar format"
        backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
        error={result.error}
      />
    )
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
