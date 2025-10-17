import { redirect } from 'next/navigation'
import PrivateBookingsClient from './PrivateBookingsClient'
import { fetchPrivateBookings } from '@/app/actions/private-bookings-dashboard'
import { checkUserPermission } from '@/app/actions/rbac'

export default async function PrivateBookingsPage() {
  const [canView, canCreate, canDelete] = await Promise.all([
    checkUserPermission('private_bookings', 'view'),
    checkUserPermission('private_bookings', 'create'),
    checkUserPermission('private_bookings', 'delete')
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const permissions = {
    hasCreatePermission: canCreate,
    hasDeletePermission: canDelete
  }

  const initialResult = await fetchPrivateBookings({
    status: 'all',
    dateFilter: 'upcoming',
    page: 1
  })

  if (!initialResult || 'error' in initialResult) {
    const errorMessage = initialResult?.error ?? 'Failed to load private bookings.'
    if (errorMessage === 'Authentication required') {
      redirect('/login')
    }
    throw new Error(errorMessage)
  }

  return (
    <PrivateBookingsClient
      permissions={permissions}
      initialBookings={initialResult.data}
      initialTotalCount={initialResult.totalCount}
      pageSize={20}
    />
  )
}
