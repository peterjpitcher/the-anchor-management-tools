import PrivateBookingDetailClient from './[id]/PrivateBookingDetailClient'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

interface Props {
  booking: PrivateBookingWithDetails
  permissions: React.ComponentProps<typeof PrivateBookingDetailClient>['permissions']
}

export default function PrivateBookingDetailServer({ booking, permissions }: Props) {
  return (
    <PrivateBookingDetailClient
      bookingId={booking.id}
      initialBooking={booking}
      permissions={permissions}
    />
  )
}
