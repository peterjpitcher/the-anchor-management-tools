import { notFound, redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { getPrivateBooking } from '@/app/actions/privateBookingActions'
import { CommunicationsTabServer } from '@/components/private-bookings/CommunicationsTabServer'
import { PageLayout } from '@/ds'
import { PB_BACK_TO_LIST, PB_DETAIL_NAV } from '../../_shared/nav'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

export default async function PrivateBookingCommunicationsPage({ params }: PageProps) {
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
  }

  const booking = result?.data ?? null

  // One header for every state. Every tab of the booking shows the customer's name.
  const layoutProps = {
    title: booking?.customer_full_name || booking?.customer_name || 'Private Booking',
    subtitle: 'Messages and emails sent, and reminders still to come',
    backButton: PB_BACK_TO_LIST,
    navItems: PB_DETAIL_NAV(bookingId),
  }

  if (!booking) {
    return <PageLayout {...layoutProps} error={result?.error ?? "We couldn't load this booking."} />
  }

  return (
    <PageLayout {...layoutProps}>
      <CommunicationsTabServer bookingId={bookingId} />
    </PageLayout>
  )
}
