import type { ParkingBookingStatus, ParkingPaymentStatus } from '@/types/parking'

type ParkingTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

/**
 * The one colour decision for a parking booking's status: waiting for payment is warning,
 * confirmed success, completed info, cancelled danger and expired neutral.
 */
export const PARKING_BOOKING_STATUS_TONE: Record<ParkingBookingStatus, ParkingTone> = {
  pending_payment: 'warning',
  confirmed: 'success',
  completed: 'info',
  cancelled: 'danger',
  expired: 'neutral',
}

/** The one colour decision for a parking payment: pending warning, paid success, refunded info. */
export const PARKING_PAYMENT_STATUS_TONE: Record<ParkingPaymentStatus, ParkingTone> = {
  pending: 'warning',
  paid: 'success',
  refunded: 'info',
  failed: 'danger',
  expired: 'neutral',
}
