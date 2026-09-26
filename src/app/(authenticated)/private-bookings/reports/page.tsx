import { redirect } from 'next/navigation'
import { PageLayout } from '@/ds'
import { getCurrentUserModuleActions, checkUserPermission } from '@/app/actions/rbac'
import {
  loadPrivateBookingGrowthSnapshot,
  type PrivateBookingGrowthSnapshot,
} from '@/lib/analytics/private-booking-growth'
import PrivateBookingGrowthReportClient from './_components/PrivateBookingGrowthReportClient'
import { privateBookingsNav } from '../_shared/nav'

export default async function PrivateBookingGrowthReportPage() {
  const [permissionsResult, canViewReports] = await Promise.all([
    getCurrentUserModuleActions('private_bookings'),
    checkUserPermission('reports', 'view'),
  ])

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') redirect('/login')
    redirect('/unauthorized')
  }

  const actions = new Set(permissionsResult.actions)
  if ((!actions.has('view') && !actions.has('manage')) || !canViewReports) {
    redirect('/unauthorized')
  }

  const canViewSmsQueue = actions.has('view_sms_queue') || actions.has('manage')
  const layoutProps = {
    title: 'Private Booking Growth',
    subtitle: 'Customer private events by the date they happened',
    navItems: privateBookingsNav({ canViewSmsQueue, canViewReports }),
  }

  // A failed load keeps the page header and tab row and says so, rather than dropping to the
  // app's error screen.
  let snapshot: PrivateBookingGrowthSnapshot
  try {
    snapshot = await loadPrivateBookingGrowthSnapshot()
  } catch (error) {
    console.error('[private-bookings/reports] Failed to load the growth snapshot', error)
    return <PageLayout {...layoutProps} error="We could not load the growth report. Refresh the page to try again." />
  }

  return (
    <PageLayout {...layoutProps}>
      <PrivateBookingGrowthReportClient snapshot={snapshot} />
    </PageLayout>
  )
}
