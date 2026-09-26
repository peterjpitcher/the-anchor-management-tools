import { redirect } from 'next/navigation'
import CalendarView from '@/components/private-bookings/CalendarView'
import { PageLayout } from '@/ds'
import { checkUserPermission, getCurrentUserModuleActions } from '@/app/actions/rbac'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'
import { privateBookingsNav } from '../_shared/nav'

export default async function PrivateBookingsCalendarPage() {
  const [permissionsResult, canViewReports] = await Promise.all([
    getCurrentUserModuleActions('private_bookings'),
    checkUserPermission('reports', 'view'),
  ])

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

  const canViewSmsQueue = actions.has('view_sms_queue') || actions.has('manage')
  const layoutProps = {
    title: 'Private Bookings Calendar',
    subtitle: 'View all bookings in calendar format',
    navItems: privateBookingsNav({ canViewSmsQueue, canViewReports }),
  }

  const result = await fetchPrivateBookingsForCalendar()

  if ('error' in result) {
    return <PageLayout {...layoutProps} error={result.error} />
  }

  // CalendarView renders the PageLayout, so its Calendar/Agenda switch can sit in the header.
  return <CalendarView bookings={result.data} layoutProps={layoutProps} />
}
