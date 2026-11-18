import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PermissionService } from '@/services/permission'
import { getParkingRateSettings, listParkingBookings } from '@/app/actions/parking'
import ParkingClient, { type ParkingInitialBookings, type ParkingInitialRates } from './_components/ParkingClient'

export default async function ParkingPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const errors: string[] = []

  // One cached permission list (60 seconds) answers all three checks, with the same super admin
  // rule as the user_has_permission RPC this page used to call three times in series.
  // 'unavailable' means the lookup failed, which is reported, never treated as a grant.
  const [viewStatus, manageStatus, refundStatus] = await Promise.all([
    PermissionService.getPermissionStatus('parking', 'view', user.id),
    PermissionService.getPermissionStatus('parking', 'manage', user.id),
    PermissionService.getPermissionStatus('parking', 'refund', user.id),
  ])

  if (viewStatus === 'unavailable') {
    console.error('Unable to verify parking view permission')
    errors.push('We could not verify your parking access. Some functionality might be limited.')
  }

  if (viewStatus === 'denied') {
    redirect('/unauthorized')
  }

  if (manageStatus === 'unavailable') {
    console.error('Unable to verify parking manage permission')
    errors.push('We could not confirm manage permissions; booking creation is currently disabled.')
  }

  if (refundStatus === 'unavailable') {
    console.error('Unable to verify parking refund permission')
    errors.push('Refund actions may be temporarily unavailable.')
  }

  const permissions = {
    canCreate: manageStatus === 'allowed',
    canManage: manageStatus === 'allowed',
    canRefund: refundStatus === 'allowed',
  }

  // The first bookings list and the rate row load here, together, instead of from the browser
  // after the page has painted. Both actions still run their own permission checks.
  const [bookingsResult, ratesResult] = await Promise.all([
    listParkingBookings(),
    permissions.canManage ? getParkingRateSettings() : Promise.resolve(null),
  ])

  const initialBookings: ParkingInitialBookings =
    bookingsResult && 'success' in bookingsResult && bookingsResult.success
      ? { data: bookingsResult.data }
      : { error: (bookingsResult && 'error' in bookingsResult && bookingsResult.error) || 'Failed to load parking bookings' }

  const initialRates: ParkingInitialRates = ratesResult
    ? 'success' in ratesResult
      ? { data: ratesResult.data }
      : { error: ratesResult.error }
    : null

  const initialError = errors.length > 0 ? errors.join(' ') : null

  return (
    <ParkingClient
      permissions={permissions}
      initialError={initialError}
      initialBookings={initialBookings}
      initialRates={initialRates}
    />
  )
}
