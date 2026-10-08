import type { ParkingBooking } from '@/types/parking'

/**
 * The only fields of a parking booking that an API key is given.
 *
 * GET /api/parking/bookings/{id} used to answer with the whole row: name,
 * mobile, email, staff notes, PayPal ids and override reasons, to anybody
 * holding the booking id and a key with parking:view. The website shows a
 * reference, the times, the vehicle, the amount and whether it is paid, and
 * nothing else, so that is all that leaves. Site review of 7 October 2026,
 * finding PY-002.
 *
 * An allow-list on purpose: a column added to parking_bookings later stays out
 * of the answer until it is named here. The names match the website's own
 * allow-list (PUBLIC_PARKING_BOOKING_FIELDS in its lib/api/parking.ts), so
 * nothing it reads today goes missing.
 */
export const API_PARKING_BOOKING_FIELDS = [
  'id',
  'reference',
  'status',
  'payment_status',
  'vehicle_registration',
  'vehicle_make',
  'vehicle_model',
  'vehicle_colour',
  'start_at',
  'end_at',
  'calculated_price',
  'override_price',
  'payment_due_at',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof ParkingBooking)[]

export type ApiParkingBooking = Pick<ParkingBooking, (typeof API_PARKING_BOOKING_FIELDS)[number]>

export function toApiParkingBooking(booking: ParkingBooking): ApiParkingBooking {
  const source = booking as unknown as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const field of API_PARKING_BOOKING_FIELDS) {
    picked[field] = source[field] ?? null
  }
  return picked as unknown as ApiParkingBooking
}
