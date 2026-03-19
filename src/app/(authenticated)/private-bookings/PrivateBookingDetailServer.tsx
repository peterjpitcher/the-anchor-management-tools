import PrivateBookingDetailClient from './[id]/PrivateBookingDetailClient'
import type { PrivateBookingWithDetails, PaymentHistoryEntry } from '@/types/private-bookings'

interface Props {
  bookingId: string
  booking: PrivateBookingWithDetails | null
  permissions: React.ComponentProps<typeof PrivateBookingDetailClient>['permissions']
  paymentHistory: PaymentHistoryEntry[]
  initialError?: string | null
}

export default function PrivateBookingDetailServer({
  bookingId,
  booking,
  permissions,
  paymentHistory,
  initialError,
}: Props) {
  return (
    <PrivateBookingDetailClient
      bookingId={bookingId}
      initialBooking={booking}
      permissions={permissions}
      paymentHistory={paymentHistory}
      initialError={initialError}
    />
  )
}
