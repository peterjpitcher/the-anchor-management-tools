import PrivateBookingDetailClient from './[id]/PrivateBookingDetailClient'
import type { DepositRefundEntry, PrivateBookingWithDetails, PaymentHistoryEntry } from '@/types/private-bookings'

interface Props {
  bookingId: string
  booking: PrivateBookingWithDetails | null
  permissions: React.ComponentProps<typeof PrivateBookingDetailClient>['permissions']
  paymentHistory: PaymentHistoryEntry[]
  depositRefunds: DepositRefundEntry[]
  depositConfirmation?: React.ComponentProps<typeof PrivateBookingDetailClient>['depositConfirmation']
  initialError?: string | null
}

export default function PrivateBookingDetailServer({
  bookingId,
  booking,
  permissions,
  paymentHistory,
  depositRefunds,
  depositConfirmation,
  initialError,
}: Props) {
  return (
    <PrivateBookingDetailClient
      bookingId={bookingId}
      initialBooking={booking}
      permissions={permissions}
      paymentHistory={paymentHistory}
      depositRefunds={depositRefunds}
      depositConfirmation={depositConfirmation}
      initialError={initialError}
    />
  )
}
