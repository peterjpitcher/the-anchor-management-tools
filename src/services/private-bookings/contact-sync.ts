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

async function readUpcomingBookings(customerId: string): Promise<UpcomingBookingRow[]> {
  const { data, error } = await createAdminClient()
    .from('private_bookings')
    .select('id, contact_phone, contact_email')
    .eq('customer_id', customerId)
    .in('status', OPEN_STATUSES)
    .gte('event_date', getTodayIsoDate())
  if (error) throw new Error(`Could not read the customer's private bookings: ${error.message}`)
  return (data ?? []) as UpcomingBookingRow[]
}

/**
 * The customer's upcoming hires that still carry the phone or email the customer has just moved
 * away from. Pure reading.
 */
export async function findUpcomingBookingsWithOldContact(
  customerId: string,
  before: ContactDetails,
  after: ContactDetails,
): Promise<string[]> {
  const phoneMoved = Boolean(before.phone?.trim()) && !samePhone(before.phone, after.phone)
  const emailMoved = Boolean(before.email?.trim()) && !sameEmail(before.email, after.email)
  if (!phoneMoved && !emailMoved) return []
  const rows = await readUpcomingBookings(customerId)
  return rows
    .filter((row) =>
      (phoneMoved && samePhone(row.contact_phone, before.phone)) ||
      (emailMoved && sameEmail(row.contact_email, before.email)),
    )
    .map((row) => row.id)
}

/**
 * Copy the customer's current phone and email onto the named upcoming hires. Only hires that
 * belong to this customer and are still ahead are touched, whatever ids are passed. Each change
 * goes on the booking's audit trail.
 */
export async function copyCustomerContactToBookings(input: {
  customerId: string
  bookingIds: string[]
  performedBy: string
}): Promise<{ updated: number }> {
  if (input.bookingIds.length === 0) return { updated: 0 }
  const admin = createAdminClient()
  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('id, mobile_e164, mobile_number, email')
    .eq('id', input.customerId)
    .maybeSingle()
  if (customerError) throw new Error(`Could not read the customer: ${customerError.message}`)
  if (!customer) throw new Error('Customer not found.')
  const phone = (customer.mobile_e164 as string | null) || (customer.mobile_number as string | null) || null
  const email = (customer.email as string | null)?.trim() || null

  const wanted = new Set(input.bookingIds)
  const rows = (await readUpcomingBookings(input.customerId)).filter((row) => wanted.has(row.id))
  let updated = 0
  for (const row of rows) {
    const patch: Record<string, string | null> = {}
    if (phone && !samePhone(row.contact_phone, phone)) patch.contact_phone = phone
    if (email && !sameEmail(row.contact_email, email)) patch.contact_email = email
    if (Object.keys(patch).length === 0) continue
    const { error } = await admin
      .from('private_bookings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('customer_id', input.customerId)
    if (error) throw new Error(`Could not update a private booking: ${error.message}`)
    const auditRows = Object.entries(patch).map(([field, value]) => ({
      booking_id: row.id,
      action: 'field_updated',
      field_name: field,
      old_value: (field === 'contact_phone' ? row.contact_phone : row.contact_email) ?? '',
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
