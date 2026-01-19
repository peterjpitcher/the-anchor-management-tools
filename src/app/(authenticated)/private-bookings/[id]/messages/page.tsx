import { notFound, redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
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

  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  const actions = new Set(permissionsResult.actions)
  const canView = actions.has('view') || actions.has('manage')
  const canSendSms = actions.has('send') || actions.has('manage')

  if (!canView) {
    redirect('/unauthorized')
  }

  let booking = null
  let initialError: string | null = null

  const result = await getPrivateBooking(bookingId, 'messages')

  if (!result || result.error) {
    if (result?.error === 'Booking not found') {
      notFound()
    }

    if (result?.error?.toLowerCase().includes('permission')) {
      redirect('/unauthorized')
    }

    initialError = result?.error ?? 'Failed to load booking'
  } else {
    booking = result.data ?? null
  }

  if (!booking && !initialError) {
    initialError = 'We could not load this booking.'
  }

  return (
    <PrivateBookingMessagesClient
      bookingId={bookingId}
      initialBooking={booking}
      initialError={initialError}
      canSendSms={canSendSms}
    />
  )
}
