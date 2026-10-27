/**
 * The email a guest typed for one table or event booking (BK-078, customer bookings review of
 * 24 October 2026).
 *
 * Bookings are matched to a customer by phone. When the number belongs to a customer with a
 * different address, or with none that a website booking may fill in, or when the typed address
 * is on another customer's record, the typed address used to be thrown away and the booking's
 * confirmation, payment link and reminders went to the old address or by text. It is now kept on
 * the booking as `contact_email` (table_bookings and bookings), and only then: when the customer
 * record already holds the typed address nothing is copied, so the column is personal data only
 * where it differs. The customer record is never changed by it; staff can copy it across with one
 * click (updateCustomerEmailFromBooking in src/app/actions/booking-contact-email.ts).
 *
 * The senders read it through preferBookingContactEmail, which swaps it in for the customer's
 * address. Erasure and data requests cover it (src/services/gdpr.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

export type BookingContactTable = 'table_bookings' | 'bookings'

type EmailState = {
  email?: string | null
  email_status?: string | null
  email_deactivated_at?: string | null
}

/** Trimmed and lower-cased, or null when empty. */
export function normaliseContactEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The customer as this booking's messages should see them: their own state, with the booking's
 * address in place of theirs when the guest gave a different one. The bounce, complaint and
 * deactivation flags describe the customer's stored address, not this one, so they are cleared
 * with the swap; suppression is still checked per address when the email is sent.
 */
export function preferBookingContactEmail<T extends EmailState>(
  customer: T,
  contactEmail: string | null | undefined
): T {
  const typed = normaliseContactEmail(contactEmail)
  if (!typed) return customer
  if (normaliseContactEmail(customer.email) === typed) return customer
  return { ...customer, email: typed, email_status: null, email_deactivated_at: null }
}

/**
 * Reads a booking's contact email. Never throws: a failed read is logged and the message falls
 * back to the customer's own address, as it did before the column existed.
 */
export async function loadBookingContactEmail(
  supabase: SupabaseClient<any, 'public', any>,
  table: BookingContactTable,
  bookingId: string | null | undefined
): Promise<string | null> {
  if (!bookingId) return null
  try {
    const { data, error } = table === 'table_bookings'
      ? await supabase.from('table_bookings').select('contact_email').eq('id', bookingId).maybeSingle()
      : await supabase.from('bookings').select('contact_email').eq('id', bookingId).maybeSingle()

    if (error) {
      logger.error('Could not read the email typed for a booking; using the customer address', {
        metadata: { table, bookingId, code: error.code ?? null, message: error.message ?? null },
      })
      return null
    }

    return normaliseContactEmail((data as { contact_email?: string | null } | null)?.contact_email)
  } catch (error) {
    logger.error('Could not read the email typed for a booking; using the customer address', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { table, bookingId },
    })
    return null
  }
}

/** The customer with this booking's typed address swapped in, read by booking id. */
export async function withBookingContactEmail<T extends EmailState>(
  supabase: SupabaseClient<any, 'public', any>,
  table: BookingContactTable,
  bookingId: string | null | undefined,
  customer: T
): Promise<T> {
  const contactEmail = await loadBookingContactEmail(supabase, table, bookingId)
  return preferBookingContactEmail(customer, contactEmail)
}

/**
 * Keeps the typed address on a booking just created. Runs with the service-role client because
 * it is called from public routes and staff routes alike, after the caller's own checks.
 *
 * Never throws: the booking stands without it, and its messages go to the customer's address as
 * they always did. A failure is logged with logger.error, which reaches production logs.
 */
export async function recordBookingContactEmail(
  table: BookingContactTable,
  bookingId: string | null | undefined,
  email: string | null | undefined
): Promise<void> {
  const contactEmail = normaliseContactEmail(email)
  if (!bookingId || !contactEmail) return

  try {
    const admin = createAdminClient()
    const { error } = table === 'table_bookings'
      ? await admin.from('table_bookings').update({ contact_email: contactEmail }).eq('id', bookingId)
      : await admin.from('bookings').update({ contact_email: contactEmail }).eq('id', bookingId)

    if (error) {
      logger.error('Could not keep the email typed for a booking', {
        metadata: { table, bookingId, code: error.code ?? null, message: error.message ?? null },
      })
    }
  } catch (error) {
    logger.error('Could not keep the email typed for a booking', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { table, bookingId },
    })
  }
}
