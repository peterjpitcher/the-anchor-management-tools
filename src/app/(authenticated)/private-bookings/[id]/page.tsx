import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import type { ActionType } from '@/types/rbac'
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

  const errors: string[] = []

  let canView = false
  let viewCheckErrored = false

  try {
    canView = await checkUserPermission('private_bookings', 'view')
  } catch (error) {
    console.error('Unable to verify private booking view permission', error)
    errors.push('We could not verify your access to private bookings; some actions may be limited.')
    viewCheckErrored = true
  }

  if (!canView && !viewCheckErrored) {
    redirect('/unauthorized')
  }

  async function safePermission(action: ActionType, description: string) {
    try {
      return await checkUserPermission('private_bookings', action)
    } catch (error) {
      console.error(`Unable to verify private booking ${action} permission`, error)
      errors.push(description)
      return false
    }
  }

  const [
    canEdit,
    canDelete,
    canManageDeposits,
    canSendSms,
    canManageSpaces,
    canManageCatering,
    canManageVendors,
  ] = await Promise.all([
    safePermission('edit', 'We could not confirm edit access; changes may be limited.'),
    safePermission('delete', 'We could not confirm delete access; cancellation may be disabled.'),
    safePermission('manage_deposits', 'We could not confirm deposit permissions; payment recording may be disabled.'),
    safePermission('send', 'We could not confirm messaging permissions; SMS actions may be disabled.'),
    safePermission('manage_spaces', 'We could not confirm venue space permissions; space updates may be disabled.'),
    safePermission('manage_catering', 'We could not confirm catering permissions; catering updates may be disabled.'),
    safePermission('manage_vendors', 'We could not confirm vendor permissions; vendor updates may be disabled.'),
  ])

  let bookingData = null

  const result = await getPrivateBooking(bookingId)

  if (!result || result.error) {
    const message = result?.error ?? 'Failed to load booking details.'

    if (message.toLowerCase().includes('permission')) {
      redirect('/unauthorized')
    }

    if (message === 'Booking not found') {
      notFound()
    }

    errors.push(message)
  } else {
    bookingData = result.data ?? null
  }

  if (!bookingData && errors.length === 0) {
    errors.push('We could not load this booking.')
  }

  const initialError = errors.length > 0 ? errors.join(' ') : null

  return (
    <PrivateBookingDetailServer
      bookingId={bookingId}
      booking={bookingData}
      permissions={{
        canEdit,
        canDelete,
        canManageDeposits,
        canSendSms,
        canManageSpaces,
        canManageCatering,
        canManageVendors,
      }}
      initialError={initialError}
    />
  )
}
