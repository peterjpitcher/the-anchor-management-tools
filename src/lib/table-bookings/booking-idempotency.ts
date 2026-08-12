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
  /** What each seat is eating. Order is the seat order and is significant. */
  preorder?: TableBookingIdempotencyPreorderEntry[] | null
}

export type TableBookingIdempotencyPreorderEntry = {
  guest_name?: string | null
  dietary_note?: string | null
  starter_menu_item_id?: string | null
  dessert_menu_item_id?: string | null
  main_menu_item_id?: string | null
  addon_menu_item_ids?: string[] | null
}

/**
 * Canonical form of the pre-order for hashing.
 *
 * Seat ORDER is preserved, because position is the seat: moving the vegan main
 * from seat 1 to seat 4 is a different order and must not replay. Add-on ids are
 * sorted, because ticking the cheeseboard before or after the pudding is the
 * same order.
 *
 * Returns undefined for an absent or empty pre-order so the stable serialiser
 * drops the key entirely, and a client that never sends one produces
 * byte-for-byte the hash it produced before the field existed.
 */
function preorderHashPayload(
  entries: TableBookingIdempotencyPreorderEntry[] | null | undefined
): unknown[] | undefined {
  if (!entries || entries.length === 0) return undefined

  return entries.map((entry) => ({
    guest_name: entry.guest_name || null,
    dietary_note: entry.dietary_note || null,
    starter_menu_item_id: entry.starter_menu_item_id || null,
    main_menu_item_id: entry.main_menu_item_id || null,
    dessert_menu_item_id: entry.dessert_menu_item_id || null,
    addon_menu_item_ids: [...new Set(entry.addon_menu_item_ids ?? [])].sort()
  }))
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
    // Changing what a guest is eating is a different booking, so a retry that
    // corrects a dish must conflict rather than replay a response that recorded
    // the old choice. Same undefined-when-absent trick as the fields above, so a
    // client that sends no pre-order hashes exactly as it did before this field.
    preorder: preorderHashPayload(fields.preorder),
    communication_consent: consentHashPayload(fields.communication_consent)
  })
}
