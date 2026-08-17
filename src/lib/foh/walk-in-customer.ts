/**
 * Creating a customer record for a walk-in.
 *
 * Both FOH booking routes need this: /api/foh/bookings for a table and
 * /api/foh/event-bookings for an event. Each carried its own 55-line copy, identical
 * apart from one being typed properly and the other taking `supabase: any` and paying
 * for it with an `as any` cast at the insert. A fix to name splitting or to the
 * duplicate-email retry applied to one route and missed on the other would have left
 * walk-ins created differently depending on which screen the bar staff used.
 */

import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * Splits a single typed-in guest name into first and last.
 *
 * FOH takes whatever is said across the bar, so this has to cope with one word, three
 * words, and stray whitespace. Everything after the first word becomes the surname
 * rather than guessing at middle names.
 */
export function splitWalkInGuestName(fullName: string | null | undefined): {
  firstName?: string
  lastName?: string
} {
  if (!fullName) {
    return {}
  }

  const cleaned = fullName.trim()
  if (!cleaned) {
    return {}
  }

  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return {}
  }

  if (parts.length === 1) {
    return { firstName: parts[0] }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  }
}

export async function createWalkInCustomer(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    firstName?: string
    lastName?: string
    guestName?: string
    email?: string | null
  }
): Promise<{ customerId: string; syntheticPhone: string }> {
  const guestNameParts = splitWalkInGuestName(input.guestName)
  const firstName = input.firstName?.trim() || guestNameParts.firstName || 'Walk-in'
  const lastName = input.lastName?.trim() || guestNameParts.lastName || ''
  const sanitizedEmail = typeof input.email === 'string' ? input.email.trim().toLowerCase() || null : null
  // Email is optional enrichment, so never let a lower(email) unique-index
  // collision block walk-in creation. On such a 23505 we drop the email and
  // retry so the booking still succeeds.
  let includeEmail = Boolean(sanitizedEmail)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
    const syntheticPhone = `+447000${suffix}`

    const { data, error } = await supabase.from('customers')
      .insert({
        first_name: firstName,
        last_name: lastName,
        mobile_number: syntheticPhone,
        mobile_e164: syntheticPhone,
        sms_opt_in: false,
        sms_status: 'sms_deactivated',
        ...(includeEmail && sanitizedEmail ? { email: sanitizedEmail } : {})
      })
      .select('id')
      .maybeSingle()

    if (!error && data?.id) {
      return {
        customerId: data.id as string,
        syntheticPhone
      }
    }

    const errorRecord = error as { code?: string; message?: string } | null
    if (errorRecord?.code === '23505') {
      if (includeEmail && /email/i.test(errorRecord.message || '')) {
        includeEmail = false
      }
      continue
    }

    throw new Error('Failed to create walk-in customer')
  }

  throw new Error('Failed to reserve a walk-in customer profile')
}
