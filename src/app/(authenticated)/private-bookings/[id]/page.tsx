import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getPrivateBooking } from '@/app/actions/privateBookingActions'
import PrivateBookingDetailServer from '../PrivateBookingDetailServer'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

export default async function PrivateBookingDetailPage({ params }: PageProps) {
  const resolvedParams = await Promise.resolve(params)
  const bookingId = resolvedParams?.id

  if (!bookingId) {
    notFound()
  }

  const [
    canView,
    canEdit,
    canDelete,
    canManageDeposits,
    canSendSms,
    canManageSpaces,
    canManageCatering,
    canManageVendors
  ] = await Promise.all([
    checkUserPermission('private_bookings', 'view'),
    checkUserPermission('private_bookings', 'edit'),
    checkUserPermission('private_bookings', 'delete'),
    checkUserPermission('private_bookings', 'manage_deposits'),
    checkUserPermission('private_bookings', 'send'),
    checkUserPermission('private_bookings', 'manage_spaces'),
    checkUserPermission('private_bookings', 'manage_catering'),
    checkUserPermission('private_bookings', 'manage_vendors')
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const result = await getPrivateBooking(bookingId)

  if (!result || result.error) {
    if (result?.error?.toLowerCase().includes('permission')) {
      redirect('/unauthorized')
    }

    if (result?.error === 'Booking not found') {
      notFound()
    }

    throw new Error(result?.error ?? 'Failed to load booking')
  }

  const booking = result.data

  if (!booking) {
    notFound()
  }

  return (
    <PrivateBookingDetailServer
      booking={booking}
      permissions={{
        canEdit,
        canDelete,
        canManageDeposits,
        canSendSms,
        canManageSpaces,
        canManageCatering,
        canManageVendors,
      }}
    />
  )
}
