import { redirect } from 'next/navigation'
import CalendarView from '@/components/private-bookings/CalendarView'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
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
    <PageWrapper>
      <PageHeader
        title="Private Bookings Calendar"
        subtitle="View all bookings in calendar format"
        backButton={{
          label: "Back to Private Bookings",
          href: "/private-bookings"
        }}
      />
      <PageContent>
        <CalendarView bookings={result.data} />
      </PageContent>
    </PageWrapper>
  )
}
