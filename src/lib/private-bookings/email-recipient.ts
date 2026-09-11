import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getEmailSuppressionStatus } from '@/lib/email/logging'
import { isEmailUsable, isValidEmailAddress } from '@/lib/notifications/channel'

export type PrivateBookingEmailRecipient =
  | { usable: true; email: string; source: 'contact_email' | 'customer_email' }
  | { usable: false; reason: 'no_address' | 'not_usable' | 'suppressed' | 'suppression_unknown' }

type RecipientBooking = {
  contact_email?: string | null
  customer_id?: string | null
}

type CustomerEmailState = {
  email: string | null
  email_status: string | null
  email_deactivated_at: string | null
}

/**
 * The address a private booking message should go to, if any (decision of 11 September 2026).
 *
 * The booking's own contact email comes first, then the customer's. An address counts only when
 * it is well formed, is not on the suppression list, and, when it is the customer's address, the
 * customer record does not mark it bounced, complained, invalid or deactivated (isEmailUsable).
 *
 * If the suppression list cannot be read the address is not used: the message goes by text, which
 * is what happens today, rather than risking a send to an address that has bounced before.
 */
export async function resolvePrivateBookingEmailRecipient(
  booking: RecipientBooking,
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<PrivateBookingEmailRecipient> {
  let customer: CustomerEmailState | null = null
  if (booking.customer_id) {
    const { data, error } = await (client.from('customers') as any)
      .select('email, email_status, email_deactivated_at')
      .eq('id', booking.customer_id)
      .maybeSingle()
    if (error) {
      logger.warn('Private booking email recipient: customer lookup failed', {
        metadata: { customerId: booking.customer_id, code: error.code ?? null, message: error.message ?? null },
      })
    } else if (data) {
      customer = data as CustomerEmailState
    }
  }

  const candidates: Array<{ email: string; source: 'contact_email' | 'customer_email' }> = []
  const contactEmail = booking.contact_email?.trim()
  if (contactEmail) candidates.push({ email: contactEmail, source: 'contact_email' })
  const customerEmail = customer?.email?.trim()
  if (customerEmail && customerEmail.toLowerCase() !== contactEmail?.toLowerCase()) {
    candidates.push({ email: customerEmail, source: 'customer_email' })
  }

  if (candidates.length === 0) {
    return { usable: false, reason: 'no_address' }
  }

  let lastReason: 'not_usable' | 'suppressed' | 'suppression_unknown' = 'not_usable'
  for (const candidate of candidates) {
    if (!isValidEmailAddress(candidate.email)) {
      lastReason = 'not_usable'
      continue
    }

    const isCustomersAddress = customer?.email?.trim().toLowerCase() === candidate.email.toLowerCase()
    if (isCustomersAddress && !isEmailUsable({ ...customer, email: candidate.email })) {
      lastReason = 'not_usable'
      continue
    }

    const suppression = await getEmailSuppressionStatus(candidate.email)
    if (suppression === 'suppressed') {
      lastReason = 'suppressed'
      continue
    }
    if (suppression === 'unavailable') {
      lastReason = 'suppression_unknown'
      continue
    }

    return { usable: true, email: candidate.email, source: candidate.source }
  }

  return { usable: false, reason: lastReason }
}
