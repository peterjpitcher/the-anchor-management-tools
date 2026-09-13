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
import { logger } from '@/lib/logger'

type WalkInSupabase = ReturnType<typeof createAdminClient>

/** The customer record made up for an anonymous walk-in, and the dummy number it was given. */
export type CreatedWalkInCustomer = { customerId: string; syntheticPhone: string }

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
  supabase: WalkInSupabase,
  input: {
    firstName?: string
    lastName?: string
    guestName?: string
    email?: string | null
  }
): Promise<CreatedWalkInCustomer> {
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

/**
 * Removes the customer record made up for a walk-in when no booking came of it.
 *
 * An anonymous walk-in needs a customer before its booking can be attempted, so
 * createWalkInCustomer runs first. When the booking is then refused or fails, the record is left
 * with a dummy number and no bookings. 68 had built up by September 2026, every one listed in
 * the customer list as a "New Customer".
 *
 * It deletes only a record that no booking refers to, because the two booking tables behave
 * differently: table_bookings refuses the delete (RESTRICT), but bookings, the event bookings,
 * cascade, so removing a customer who holds even a cancelled event booking would erase it. The
 * delete is also pinned to the dummy number this request generated, so it can never reach a
 * real customer.
 *
 * Best effort, and never throws: a leftover record is untidy, but it must not turn an answer
 * already given to staff into a failure. Failures go to logger.error, because logger.warn
 * prints nothing in production.
 */
export async function discardUnusedWalkInCustomer(
  supabase: WalkInSupabase,
  walkInCustomer: CreatedWalkInCustomer,
  context: { route: string; userId?: string | null },
): Promise<'deleted' | 'kept' | 'failed'> {
  const logContext = {
    route: context.route,
    userId: context.userId ?? null,
    customerId: walkInCustomer.customerId,
  }

  try {
    for (const table of ['table_bookings', 'bookings'] as const) {
      const { data, error } = await supabase.from(table).select('id').eq('customer_id', walkInCustomer.customerId)

      if (error) {
        logger.error('Could not check an unused walk-in customer for bookings, so left it in place', {
          metadata: {
            ...logContext,
            table,
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          },
        })
        return 'failed'
      }

      // Anything other than an empty list means a booking may point at it: keep it.
      if (data && (!Array.isArray(data) || data.length > 0)) {
        return 'kept'
      }
    }

    const { error: deleteError } = await supabase
      .from('customers')
      .delete()
      .eq('id', walkInCustomer.customerId)
      .eq('mobile_e164', walkInCustomer.syntheticPhone)

    if (deleteError) {
      logger.error('Failed to remove an unused walk-in customer', {
        metadata: {
          ...logContext,
          code: deleteError.code,
          message: deleteError.message,
          details: deleteError.details,
          hint: deleteError.hint,
        },
      })
      return 'failed'
    }

    return 'deleted'
  } catch (cleanupError) {
    logger.error('Failed to remove an unused walk-in customer', {
      error: cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
      metadata: logContext,
    })
    return 'failed'
  }
}

/**
 * What a request made up for an anonymous walk-in. The route fills it in as it goes: the
 * customer once createWalkInCustomer returns, and bookingPersisted once a booking row exists.
 */
export type WalkInCustomerTrail = {
  supabase: WalkInSupabase | null
  userId: string | null
  customer: CreatedWalkInCustomer | null
  bookingPersisted: boolean
}

export function startWalkInCustomerTrail(): WalkInCustomerTrail {
  return { supabase: null, userId: null, customer: null, bookingPersisted: false }
}

/**
 * Called on every way out of a walk-in route, from a `finally`. Removes the made-up customer
 * only when this request created one and no booking row came of it. Never throws.
 */
export async function finishWalkInCustomerTrail(trail: WalkInCustomerTrail, route: string): Promise<void> {
  if (trail.supabase && trail.customer && !trail.bookingPersisted) {
    await discardUnusedWalkInCustomer(trail.supabase, trail.customer, { route, userId: trail.userId })
  }
}
