import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button, PageHeader } from '@/ds'
import { getCurrentUserModuleActions, checkUserPermission } from '@/app/actions/rbac'
import { loadPrivateBookingGrowthSnapshot } from '@/lib/analytics/private-booking-growth'
import PrivateBookingGrowthReportClient from './_components/PrivateBookingGrowthReportClient'

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

  const snapshot = await loadPrivateBookingGrowthSnapshot()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[
          { label: 'Private Bookings', href: '/private-bookings' },
          { label: 'Growth report' },
        ]}
        title="Private booking growth"
        subtitle="Customer private events by the date they happened"
        className="mb-0"
        actions={
          <Link href="/private-bookings">
            <Button variant="secondary" size="sm">Back to bookings</Button>
          </Link>
        }
      />
      <PrivateBookingGrowthReportClient snapshot={snapshot} />
    </div>
  )
}
