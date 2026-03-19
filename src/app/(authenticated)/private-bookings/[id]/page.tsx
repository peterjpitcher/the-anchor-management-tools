import { notFound, redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { getPrivateBooking } from '@/app/actions/privateBookingActions'
import { getBookingPaymentHistory } from '@/services/private-bookings'
import type { PaymentHistoryEntry } from '@/types/private-bookings'
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
  let canEdit = false
  let canDelete = false
  let canManageDeposits = false
  let canSendSms = false
  let canManageSpaces = false
  let canManageCatering = false
  let canManageVendors = false
  let canEditPayments = false

  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }

    console.error('Unable to verify private bookings permissions', permissionsResult.error)
    errors.push('We could not verify your access to private bookings; some actions may be limited.')
  } else {
    const actions = new Set(permissionsResult.actions)

    canView = actions.has('view') || actions.has('manage')
    canEdit = actions.has('edit') || actions.has('manage')
    canDelete = actions.has('delete')
    canManageDeposits = actions.has('manage_deposits') || actions.has('manage')
    canSendSms = actions.has('send') || actions.has('manage')
    canManageSpaces = actions.has('manage_spaces') || actions.has('manage')
    canManageCatering = actions.has('manage_catering') || actions.has('manage')
    canManageVendors = actions.has('manage_vendors') || actions.has('manage')
    canEditPayments = actions.has('manage')
  }

  if (!canView && errors.length === 0) {
    redirect('/unauthorized')
  }

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

  let paymentHistory: PaymentHistoryEntry[] = []
  if (bookingData) {
    try {
      paymentHistory = await getBookingPaymentHistory(bookingData.id)
    } catch (_err) {
      // Non-fatal: page still renders, payment history will be empty
    }
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
        canEditPayments,
      }}
      paymentHistory={paymentHistory}
      initialError={initialError}
    />
  )
}
