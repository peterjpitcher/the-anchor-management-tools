import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'

/**
 * A private booking keeps its own contact phone and email, copied from the customer when it was
 * made. When staff change the customer's phone or email, the upcoming hires still carry the old
 * ones, and their texts and emails keep going to the old number and address (BK-163). These two
 * helpers find those hires and, when staff say so, bring them up to date. Nothing changes a
 * booking without that yes.
 */

/** The statuses of a hire that is still going ahead. */
const OPEN_STATUSES = ['draft', 'confirmed']

export interface ContactDetails {
  phone: string | null
  email: string | null
}

function phoneVariants(phone: string | null | undefined): Set<string> {
  const variants = new Set<string>()
  if (!phone?.trim()) return variants
  try {
    for (const variant of generatePhoneVariants(formatPhoneForStorage(phone))) variants.add(variant)
  } catch {
    // Not a number this app can read: only the exact text matches.
  }
  variants.add(phone.trim())
  return variants
}

function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false
  const left = phoneVariants(a)
  for (const variant of phoneVariants(b)) if (left.has(variant)) return true
  return false
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a?.trim() && b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase())
}

interface UpcomingBookingRow {
  id: string
  contact_phone: string | null
  contact_email: string | null
}

/** A booking field staff can bring up to date from the customer. */
export type BookingContactField = 'contact_phone' | 'contact_email'

/**
 * One upcoming hire to offer an update for, and which of its fields still carry the customer's
 * old details. Only those fields are offered: a booking can hold its own organiser's email, which
 * a change to the customer's phone must not touch, and the other way round.
 */
export interface BookingContactOffer {
  bookingId: string
  fields: BookingContactField[]
}

const SELECT = 'id, contact_phone, contact_email'

/**
 * The customer's hires that are still going ahead: those dated today or later, and those whose
 * date is still to be confirmed, whose event_date is only a placeholder (the day the enquiry came
 * in) and would otherwise drop out the day after.
 */
async function readUpcomingBookings(customerId: string): Promise<UpcomingBookingRow[]> {
  const admin = createAdminClient()
  const [dated, undated] = await Promise.all([
    admin.from('private_bookings').select(SELECT).eq('customer_id', customerId).in('status', OPEN_STATUSES)
      .gte('event_date', getTodayIsoDate()),
    admin.from('private_bookings').select(SELECT).eq('customer_id', customerId).in('status', OPEN_STATUSES)
      .eq('date_tbd', true),
  ])
  const error = dated.error ?? undated.error
  if (error) throw new Error(`Could not read the customer's private bookings: ${error.message}`)
  const byId = new Map<string, UpcomingBookingRow>()
  for (const row of [...(dated.data ?? []), ...(undated.data ?? [])] as UpcomingBookingRow[]) byId.set(row.id, row)
  return Array.from(byId.values())
}

/**
 * The customer's upcoming hires that still carry the phone or email the customer has just moved
 * away from, or cleared, with the fields that do. Pure reading.
 */
export async function findUpcomingBookingsWithOldContact(
  customerId: string,
  before: ContactDetails,
  after: ContactDetails,
): Promise<BookingContactOffer[]> {
  const phoneMoved = Boolean(before.phone?.trim()) && !samePhone(before.phone, after.phone)
  const emailMoved = Boolean(before.email?.trim()) && !sameEmail(before.email, after.email)
  if (!phoneMoved && !emailMoved) return []
  const rows = await readUpcomingBookings(customerId)
  const offers: BookingContactOffer[] = []
  for (const row of rows) {
    const fields: BookingContactField[] = []
    if (phoneMoved && samePhone(row.contact_phone, before.phone)) fields.push('contact_phone')
    if (emailMoved && sameEmail(row.contact_email, before.email)) fields.push('contact_email')
    if (fields.length > 0) offers.push({ bookingId: row.id, fields })
  }
  return offers
}

/**
 * Copy the customer's current phone and email onto the offered fields of the offered upcoming
 * hires. Only hires that belong to this customer and are still going ahead are touched, and only
 * the fields offered for each. A detail the customer has had cleared is cleared on the booking
 * too. Each change goes on the booking's audit trail.
 */
export async function copyCustomerContactToBookings(input: {
  customerId: string
  offers: BookingContactOffer[]
  performedBy: string
}): Promise<{ updated: number }> {
  if (input.offers.length === 0) return { updated: 0 }
  const admin = createAdminClient()
  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('id, mobile_e164, mobile_number, email')
    .eq('id', input.customerId)
    .maybeSingle()
  if (customerError) throw new Error(`Could not read the customer: ${customerError.message}`)
  if (!customer) throw new Error('Customer not found.')
  const current: Record<BookingContactField, string | null> = {
    contact_phone: (customer.mobile_e164 as string | null) || (customer.mobile_number as string | null) || null,
    contact_email: (customer.email as string | null)?.trim() || null,
  }

  const offered = new Map(input.offers.map((offer) => [offer.bookingId, offer.fields]))
  const rows = (await readUpcomingBookings(input.customerId)).filter((row) => offered.has(row.id))
  let updated = 0
  for (const row of rows) {
    const patch: Partial<Record<BookingContactField, string | null>> = {}
    for (const field of offered.get(row.id) ?? []) {
      if (field !== 'contact_phone' && field !== 'contact_email') continue
      const next = current[field]
      const same = field === 'contact_phone' ? samePhone(row[field], next) : sameEmail(row[field], next)
      if (same || (next === null && !row[field])) continue
      patch[field] = next
    }
    if (Object.keys(patch).length === 0) continue
    const { error } = await admin
      .from('private_bookings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('customer_id', input.customerId)
    if (error) throw new Error(`Could not update a private booking: ${error.message}`)
    const auditRows = (Object.entries(patch) as Array<[BookingContactField, string | null]>).map(([field, value]) => ({
      booking_id: row.id,
      action: 'field_updated',
      field_name: field,
      old_value: row[field] ?? '',
      new_value: value ?? '',
      performed_by: input.performedBy,
      metadata: { via: 'customer_contact_changed' },
    }))
    const { error: auditError } = await admin.from('private_booking_audit').insert(auditRows)
    if (auditError) throw new Error(`Could not record the change on the booking: ${auditError.message}`)
    updated += 1
  }
  return { updated }
}

/**
 * Whether a booking's contact phone is someone other than its customer's mobile, for a plain
 * note to staff when they save it. Texts still go to the booking's number (BK-163); the note
 * says so, so a typo is caught. Null when they match or either is missing.
 */
export async function contactPhoneDiffersNote(bookingId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data: booking, error } = await admin
    .from('private_bookings')
    .select('id, contact_phone, customer_id, customer:customers(mobile_e164, mobile_number)')
    .eq('id', bookingId)
    .maybeSingle()
  if (error || !booking?.contact_phone || !booking.customer_id) return null
  const customer = (Array.isArray(booking.customer) ? booking.customer[0] : booking.customer) as
    | { mobile_e164?: string | null; mobile_number?: string | null }
    | null
  const customerPhone = customer?.mobile_e164 || customer?.mobile_number || null
  if (!customerPhone || samePhone(booking.contact_phone as string, customerPhone)) return null
  return 'The contact phone on this booking is not the mobile on the customer record. Texts for this booking go to the booking\'s number; check it is right.'
}
