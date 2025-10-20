import PrivateBookingDetailClient from './[id]/PrivateBookingDetailClient'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

interface Props {
  bookingId: string
  booking: PrivateBookingWithDetails | null
  permissions: React.ComponentProps<typeof PrivateBookingDetailClient>['permissions']
  initialError?: string | null
}

export default function PrivateBookingDetailServer({
  bookingId,
  booking,
  permissions,
  initialError,
}: Props) {
  return (
    <PrivateBookingDetailClient
      bookingId={bookingId}
      initialBooking={booking}
      permissions={permissions}
      initialError={initialError}
    />
  )
}
