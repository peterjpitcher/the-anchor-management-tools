import { computeIdempotencyRequestHash } from '@/lib/api/idempotency'
import { consentHashPayload } from '@/lib/consent/validation'
import type { CommunicationConsentPayload } from '@/lib/consent/types'

/**
 * The booking fields that define a distinct booking intent for idempotency.
 * `phone` is the storage-normalised E.164 number and `time` the zero-padded
 * HH:MM:SS booking time; the route normalises both before hashing so the same
 * intent posted twice hashes identically regardless of input formatting.
 */
export type TableBookingIdempotencyFields = {
  phone: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  date: string
  time: string
  party_size: number
  purpose: string
  notes?: string | null
  dietary_requirements?: string[] | null
  allergies?: string[] | null
  high_chair_count?: number | null
  outside_seating?: boolean | null
  requires_accessible_table?: boolean | null
  /** The seasonal period offered and what the guest answered. See the note in the hash below. */
  booking_period_id?: string | null
  booking_period_answer?: boolean | null
  communication_consent?: CommunicationConsentPayload
}

/**
 * One canonical request hash for table-booking creation (review F18): every
 * field that changes what is booked varies the hash, so a retry with a changed
 * intent is a conflict rather than a silent replay of the earlier booking.
 */
export function computeTableBookingRequestHash(fields: TableBookingIdempotencyFields): string {
  return computeIdempotencyRequestHash({
    phone: fields.phone,
    first_name: fields.first_name || null,
    last_name: fields.last_name || null,
    email: fields.email || null,
    date: fields.date,
    time: fields.time,
    party_size: fields.party_size,
    purpose: fields.purpose,
    notes: fields.notes || null,
    dietary_requirements: fields.dietary_requirements ?? null,
    allergies: fields.allergies ?? null,
    // Vary the idempotency key when the chair/outside request changes so a
    // repeat with different chairs/outside mints a fresh key rather than
    // replaying the earlier booking.
    high_chair_count: fields.high_chair_count ?? null,
    outside_seating: fields.outside_seating ?? null,
    // Accessibility varies the hash ONLY when requested (review F18). The
    // stable serialiser drops undefined entries, so absent-or-false produces
    // byte-for-byte the hash this route produced before the field existed:
    // an old website that omits the field (F37), and any claim persisted
    // before this deploy, still replay cleanly instead of 409ing.
    requires_accessible_table: fields.requires_accessible_table === true ? true : undefined,
    // Answering the seasonal question differently is a DIFFERENT booking: it changes the menu, the
    // deposit and the refund terms, so a retry that flips the answer must conflict rather than
    // replay the earlier booking silently. Same undefined-when-absent trick as accessibility above:
    // a client that never sends these produces byte-for-byte the hash it produced before the fields
    // existed, so bookings already in flight at deploy time replay cleanly instead of 409ing.
    booking_period_id: fields.booking_period_id || undefined,
    booking_period_answer: typeof fields.booking_period_answer === 'boolean'
      ? fields.booking_period_answer
      : undefined,
    communication_consent: consentHashPayload(fields.communication_consent)
  })
}
