import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getPrivateBooking } from '@/app/actions/privateBookingActions'
import PrivateBookingMessagesClient from './PrivateBookingMessagesClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

export default async function PrivateBookingMessagesPage({ params }: PageProps) {
  const resolvedParams = await Promise.resolve(params)
  const bookingId = resolvedParams?.id

  if (!bookingId) {
    notFound()
  }

  const [canView, canSendSms] = await Promise.all([
    checkUserPermission('private_bookings', 'view'),
    checkUserPermission('private_bookings', 'send')
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const result = await getPrivateBooking(bookingId)

  if (!result || result.error) {
    if (result?.error === 'Booking not found') {
      notFound()
    }

    if (result?.error?.toLowerCase().includes('permission')) {
      redirect('/unauthorized')
    }

    throw new Error(result?.error ?? 'Failed to load booking')
  }

  const booking = result.data

  if (!booking) {
    notFound()
  }

  return (
    <PrivateBookingMessagesClient
      bookingId={bookingId}
      initialBooking={booking}
      canSendSms={canSendSms}
    />
  )
}
