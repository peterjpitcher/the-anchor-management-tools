import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { getPrivateBooking } from '@/app/actions/privateBookingActions'
import { CommunicationsTabServer } from '@/components/private-bookings/CommunicationsTabServer'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'

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
  const title = booking?.customer_full_name || booking?.customer_name || 'Private booking'

  const navItems = [
    { label: 'Overview', href: `/private-bookings/${bookingId}` },
    { label: 'Items', href: `/private-bookings/${bookingId}/items` },
    { label: 'Messages', href: `/private-bookings/${bookingId}/messages` },
    { label: 'Communications', href: `/private-bookings/${bookingId}/communications` },
    { label: 'Contract', href: `/private-bookings/${bookingId}/contract` },
  ]

  return (
    <PageLayout
      title={title}
      subtitle="Communications"
      breadcrumbs={[
        { label: 'Private Bookings', href: '/private-bookings' },
        { label: title, href: `/private-bookings/${bookingId}` },
        { label: 'Communications', href: '' },
      ]}
      backButton={{ label: 'Back to booking', href: `/private-bookings/${bookingId}` }}
      navItems={navItems}
    >
      {!booking ? (
        <Alert
          variant="error"
          title="We couldn’t load this booking"
          description="Head back to the booking list and try again."
        >
          <Link
            href="/private-bookings"
            className="text-sm font-medium text-blue-700 hover:text-blue-900"
          >
            Back to private bookings
          </Link>
        </Alert>
      ) : (
        <CommunicationsTabServer bookingId={bookingId} />
      )}
    </PageLayout>
  )
}
