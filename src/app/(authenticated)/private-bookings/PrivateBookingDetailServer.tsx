import PrivateBookingDetailClient from './[id]/PrivateBookingDetailClient'
import type { DepositRefundEntry, PrivateBookingWithDetails, PaymentHistoryEntry } from '@/types/private-bookings'

interface Props {
  bookingId: string
  booking: PrivateBookingWithDetails | null
  permissions: React.ComponentProps<typeof PrivateBookingDetailClient>['permissions']
  paymentHistory: PaymentHistoryEntry[]
  depositRefunds: DepositRefundEntry[]
  depositConfirmation?: React.ComponentProps<typeof PrivateBookingDetailClient>['depositConfirmation']
  hireReadiness?: React.ComponentProps<typeof PrivateBookingDetailClient>['hireReadiness']
  hireReadinessError?: boolean
  hireNight?: React.ComponentProps<typeof PrivateBookingDetailClient>['hireNight']
  hireNightError?: boolean
  canOverrideCapacity?: boolean
  initialError?: string | null
}

export default function PrivateBookingDetailServer({
  bookingId,
  booking,
  permissions,
  paymentHistory,
  depositRefunds,
  depositConfirmation,
  hireReadiness,
  hireReadinessError,
  hireNight,
  hireNightError,
  canOverrideCapacity,
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
      hireReadiness={hireReadiness}
      hireReadinessError={hireReadinessError}
      hireNight={hireNight}
      hireNightError={hireNightError}
      canOverrideCapacity={canOverrideCapacity}
      initialError={initialError}
    />
  )
}
