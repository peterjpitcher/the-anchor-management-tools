import { redirect } from 'next/navigation'
import PrivateBookingsClient from './PrivateBookingsClient'
import {
  fetchPrivateBookings,
  type PrivateBookingDashboardItem
} from '@/app/actions/private-bookings-dashboard'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'

export default async function PrivateBookingsPage() {
  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  const actions = new Set(permissionsResult.actions)
  const canView = actions.has('view') || actions.has('manage')
  const canCreate = actions.has('create') || actions.has('manage')
  const canDelete = actions.has('delete')

  if (!canView) {
    redirect('/unauthorized')
  }

  const permissions = {
    hasCreatePermission: canCreate,
    hasDeletePermission: canDelete
  }

  let initialBookings: PrivateBookingDashboardItem[] = []
  let initialTotalCount = 0
  let initialError: string | null = null

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
    initialError = errorMessage
  } else {
    initialBookings = initialResult.data
    initialTotalCount = initialResult.totalCount
  }

  return (
    <PrivateBookingsClient
      permissions={permissions}
      initialBookings={initialBookings}
      initialTotalCount={initialTotalCount}
      pageSize={20}
      initialError={initialError}
    />
  )
}
