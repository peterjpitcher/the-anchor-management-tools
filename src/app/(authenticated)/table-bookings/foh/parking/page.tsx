import { redirect } from 'next/navigation'
import { PageLayout } from '@/ds'
import { getPermissionStatus } from '@/app/actions/rbac'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'
import { FohParkingClient } from './FohParkingClient'

/**
 * Parking for the till (owner request, 23 November 2026). It lives under /table-bookings/foh so
 * the shared FOH login can reach it, and it is gated on table_bookings view like the floor screen:
 * that login holds no parking permission and is not given one, because the real parking pages
 * show prices. This page is read only and shows none.
 */
export default async function FohParkingPage() {
  const viewStatus = await getPermissionStatus('table_bookings', 'view')

  // A failed lookup is a connection problem, not a refusal (BK-095).
  if (viewStatus === 'unavailable') return <PermissionsUnavailable />
  if (viewStatus !== 'allowed') redirect('/unauthorized')

  return (
    <PageLayout
      title="Parking"
      subtitle="What is booked, for the bar. To change a booking, ask a manager."
      compactHeader
    >
      <FohParkingClient />
    </PageLayout>
  )
}
