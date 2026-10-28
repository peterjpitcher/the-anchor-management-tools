import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'
import { isPlaceholderName } from '@/lib/sms/name-utils'
import { detectOptOut, type OptOutScope } from '@/lib/sms/opt-out-keywords'
import { ConsentService } from '@/services/consent'
import { logger } from '@/lib/logger'
import { maskPhone, maskPhones } from '@/lib/phone/mask'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'

type CustomerFallback = {
  firstName?: string
  lastName?: string
  email?: string | null
}

type ResolvedCustomerResult = {
  customerId: string | null
  standardizedPhone?: string | null
  resolutionError?: string
  resolvedFirstName?: string
  /**
   * The email typed for this booking when the customer record does not hold it: the number
   * belongs to a customer with another address (or none that we may fill in), or the address
   * belongs to a different customer. Callers keep it on the booking (`contact_email`), so this
   * booking's messages go where the guest asked, and the customer record is left alone (BK-078).
   * Null when the record already holds the typed address or none was typed.
   */
  bookingContactEmail?: string | null
}

type EnsureCustomerOptions = {
  /**
   * True only when a member of staff typed the details while dealing with the guest (front of
   * house, the door, a staff booking form). Staff entries may fill a blank email on the matched
   * customer. A website caller has no proof the person typing owns the number, so it never
   * writes an email onto someone else's record (BK-077); its typed address stays on the booking.
   * Off by default, so a new caller is safe until it says otherwise.
   */
  trustedEntry?: boolean
}

type CustomerLookupRow = {
  id: string
  mobile_e164: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

function normalizeFallbackNameParts(input: {
  firstName?: string
  lastName?: string
}): { firstName?: string; lastName?: string } {
  const firstName = input.firstName?.trim()
  const lastName = input.lastName?.trim()

  if (!firstName) {
    return { firstName: undefined, lastName: lastName || undefined }
  }

  if (lastName || !/\s/.test(firstName)) {
    return {
      firstName,
      lastName: lastName || undefined
    }
  }

  const parts = firstName.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) {
    return {
      firstName,
      lastName: undefined
    }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  }
}

function isPlaceholderLastName(value: string | null | undefined): boolean {
  const cleaned = value?.trim().toLowerCase()
  if (!cleaned) {
    return true
  }

  if (cleaned === 'unknown' || cleaned === 'guest' || cleaned === 'contact') {
    return true
  }

  return /^\d{3,}$/.test(cleaned)
}

async function enrichMatchedCustomer(
  client: SupabaseClient<Database, 'public'>,
  input: {
    existingCustomer: CustomerLookupRow
    standardizedPhone: string
    fallbackFirstName?: string
    fallbackLastName?: string
    fallbackEmail?: string | null
  }
): Promise<{ emailWritten: boolean }> {
  const updatePayload: Record<string, string> = {}

  if (!input.existingCustomer.mobile_e164) {
    updatePayload.mobile_e164 = input.standardizedPhone
  }

  if (input.fallbackFirstName && isPlaceholderName(input.existingCustomer.first_name)) {
    updatePayload.first_name = input.fallbackFirstName
  }

  if (input.fallbackLastName && isPlaceholderLastName(input.existingCustomer.last_name)) {
    updatePayload.last_name = input.fallbackLastName
  }

  if (input.fallbackEmail && !input.existingCustomer.email?.trim()) {
    updatePayload.email = input.fallbackEmail
  }

  if (Object.keys(updatePayload).length === 0) {
    return { emailWritten: false }
  }

  const { data: updatedCustomer, error } = await client
    .from('customers')
    .update(updatePayload)
    .eq('id', input.existingCustomer.id)
    .select('id')
    .maybeSingle()

  if (error) {
    // Ids and codes only: the payload carries the guest's name and email.
    console.error('Failed to enrich existing customer profile:', JSON.stringify({
      customerId: input.existingCustomer.id,
      code: error.code ?? null,
      message: error.message ?? null,
    }))
    return { emailWritten: false }
  }

  if (!updatedCustomer) {
    console.warn('Customer enrichment update affected no rows', {
      customerId: input.existingCustomer.id
    })
    return { emailWritten: false }
  }

  return { emailWritten: Boolean(updatePayload.email) }
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a?.trim().toLowerCase() || null
  const right = b?.trim().toLowerCase() || null
  return left !== null && left === right
}

/**
 * The typed email to keep on the booking, or null when the customer record already holds it.
 */
function contactEmailForBooking(
  typedEmail: string | null,
  storedEmail: string | null | undefined,
  emailWritten: boolean
): string | null {
  if (!typedEmail) return null
  if (emailWritten || sameEmail(typedEmail, storedEmail)) return null
  return typedEmail
}

function deriveNameParts(fullName?: string | null): CustomerFallback {
  if (!fullName) {
    return {}
  }

  const parts = fullName
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return {}
  }

  const [firstName, ...rest] = parts
  const lastName = rest.length > 0 ? rest.join(' ') : undefined

  return {
    firstName,
    lastName
  }
}

async function findCustomerByPhone(
  client: SupabaseClient<Database, 'public'>,
  standardizedPhone: string,
  numbersToMatch: string[]
): Promise<{ customer: CustomerLookupRow | null; lookupError: boolean }> {
  const { data: canonicalMatches, error: canonicalLookupError } = await client
    .from('customers')
    .select('id, mobile_e164, first_name, last_name, email')
    .eq('mobile_e164', standardizedPhone)
    .order('created_at', { ascending: true })
    .limit(1)

  if (canonicalLookupError) {
    console.error('Failed to look up customer by mobile_e164:', canonicalLookupError)
    return { customer: null, lookupError: true }
  }

  if (canonicalMatches && canonicalMatches.length > 0) {
    return {
      customer: canonicalMatches[0] as CustomerLookupRow,
      lookupError: false
    }
  }

  const { data: legacyMatches, error: legacyLookupError } = await client
    .from('customers')
    .select('id, mobile_e164, first_name, last_name, email')
    .in('mobile_number', numbersToMatch)
    .order('created_at', { ascending: true })
    .limit(1)

  if (legacyLookupError) {
    console.error('Failed to look up customer by legacy mobile_number:', legacyLookupError)
    return { customer: null, lookupError: true }
  }

  return {
    customer:
      legacyMatches && legacyMatches.length > 0
        ? (legacyMatches[0] as CustomerLookupRow)
        : null,
    lookupError: false
  }
}

type HeldSmsOptOut = { scope: OptOutScope; keyword: string; unmatchedId: string }

/**
 * A STOP or NOEVENTS this number sent before we had a customer for it (BK-080).
 *
 * An inbound text from a number we do not know waits in the holding queue
 * (unmatched_communications) until staff link it, and only then is its opt-out applied
 * (src/services/communications.ts). A booking made in the meantime created the customer
 * SMS-active, so the guest who had said STOP was texted again. The strongest keyword wins: a
 * full STOP over a marketing-only NOEVENTS.
 *
 * A failed read returns null and is logged: Twilio still refuses texts to a number that sent STOP
 * (and that refusal is recorded, src/lib/sms/provider-opt-out.ts), so the booking goes ahead.
 */
async function findHeldSmsOptOut(
  client: SupabaseClient<Database, 'public'>,
  numbersToMatch: string[]
): Promise<HeldSmsOptOut | null> {
  try {
    const { data, error } = await client
      .from('unmatched_communications')
      .select('id, body_text')
      .eq('channel', 'sms')
      .eq('direction', 'inbound')
      .in('from_address', numbersToMatch)
      .is('linked_customer_id', null)
      .order('received_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Could not check the holding queue for an opt-out before creating a customer', JSON.stringify({
        code: error.code ?? null,
        message: error.message ?? null,
      }))
      return null
    }

    let held: HeldSmsOptOut | null = null
    for (const row of (data ?? []) as Array<{ id: string; body_text: string | null }>) {
      const detection = detectOptOut(row.body_text)
      if (!detection) continue
      if (detection.scope === 'all') return { ...detection, unmatchedId: row.id }
      held = held ?? { ...detection, unmatchedId: row.id }
    }
    return held
  } catch (error) {
    console.error('Could not check the holding queue for an opt-out before creating a customer', error instanceof Error ? error.message : String(error))
    return null
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export async function ensureCustomerForPhone(
  supabase: SupabaseClient<Database, 'public'> | undefined,
  phone: string | null | undefined,
  fallback: CustomerFallback = {},
  options: EnsureCustomerOptions = {}
): Promise<ResolvedCustomerResult> {
  if (!phone) {
    return { customerId: null, standardizedPhone: null }
  }

  const client = supabase ?? createAdminClient()

  try {
    const standardizedPhone = formatPhoneForStorage(phone)
    const variants = generatePhoneVariants(standardizedPhone)
    const numbersToMatch = variants.length > 0 ? variants : [standardizedPhone]
    const normalizedName = normalizeFallbackNameParts({
      firstName: fallback.firstName,
      lastName: fallback.lastName
    })
    const sanitizedEmail =
      typeof fallback.email === 'string'
        ? fallback.email.trim().toLowerCase() || null
        : null

    const providedFirstName = normalizedName.firstName && normalizedName.firstName.length > 0
      ? normalizedName.firstName
      : undefined
    const providedLastName = normalizedName.lastName && normalizedName.lastName.length > 0
      ? normalizedName.lastName
      : undefined

    // A matched customer only ever has placeholders filled. A typed email is written onto their
    // record only by a staff entry and only when the record has none; anything else stays on the
    // booking as its contact email.
    const attachToMatchedCustomer = async (
      match: CustomerLookupRow
    ): Promise<ResolvedCustomerResult> => {
      const enrichment = await enrichMatchedCustomer(client, {
        existingCustomer: match,
        standardizedPhone,
        fallbackFirstName: providedFirstName,
        fallbackLastName: providedLastName,
        fallbackEmail: options.trustedEntry === true ? sanitizedEmail : null
      })

      return {
        customerId: match.id,
        standardizedPhone,
        resolvedFirstName: providedFirstName || match.first_name || undefined,
        bookingContactEmail: contactEmailForBooking(sanitizedEmail, match.email, enrichment.emailWritten)
      }
    }

    const lookup = await findCustomerByPhone(client, standardizedPhone, numbersToMatch)
    const existingMatch = lookup.customer
    if (existingMatch) {
      return attachToMatchedCustomer(existingMatch)
    }

    if (lookup.lookupError) {
      // Fail closed when customer safety lookups are unavailable.
      return { customerId: null, standardizedPhone, resolutionError: 'lookup_failed' }
    }

    const fallbackFirstName = providedFirstName
      ? providedFirstName
      : 'Unknown'

    // The database column is non-null, but an empty string correctly records
    // that the customer chose not to provide a last name.
    const fallbackLastName = providedLastName
      ? providedLastName
      : ''

    // A STOP or NOEVENTS this number sent before it had a customer starts the customer opted out.
    const heldOptOut = await findHeldSmsOptOut(client, numbersToMatch)
    const optedOutAt = new Date().toISOString()

    const insertPayload = {
      first_name: fallbackFirstName,
      last_name: fallbackLastName,
      mobile_number: standardizedPhone,
      mobile_e164: standardizedPhone,
      email: sanitizedEmail,
      sms_opt_in: heldOptOut?.scope !== 'all',
      sms_status: heldOptOut?.scope === 'all' ? 'opted_out' : 'active',
      sms_opted_out_at: heldOptOut?.scope === 'all' ? optedOutAt : null,
      marketing_sms_opt_in: false,
      marketing_sms_opted_out_at: heldOptOut ? optedOutAt : null,
      whatsapp_opt_in: true,
      whatsapp_status: 'active',
      marketing_whatsapp_opt_in: false,
      marketing_email_opt_in: false
    }

    const insertCustomer = (payload: typeof insertPayload) =>
      client
        .from('customers')
        .insert(payload)
        .select('id')
        .single()

    let { data: inserted, error: insertError } = await insertCustomer(insertPayload)
    let typedEmailLeftOff = false

    if (isUniqueViolation(insertError)) {
      // A unique violation here can be a phone collision (idx_customers_mobile_e164), when
      // another request created this number's customer a moment ago, or an email collision
      // (idx_customers_email_unique). Try the phone owner first.
      const conflictLookup = await findCustomerByPhone(client, standardizedPhone, numbersToMatch)
      if (conflictLookup.customer) {
        return attachToMatchedCustomer(conflictLookup.customer)
      }

      if (conflictLookup.lookupError) {
        return { customerId: null, standardizedPhone, resolutionError: 'lookup_failed' }
      }

      // Nobody has this number, so the clash is on the email: the typed address is on another
      // customer's record. Until October 2026 the booking was put on THAT customer, so their
      // stored mobile got this guest's texts and payment links and the real booker heard
      // nothing (BK-077). The number gets a customer of its own without the email, the other
      // record is left as it is, and the booking keeps the typed address as its contact email.
      // Parking made the same change on 19 October 2026 (src/lib/parking/customers.ts).
      if (sanitizedEmail) {
        ;({ data: inserted, error: insertError } = await insertCustomer({ ...insertPayload, email: null }))
        typedEmailLeftOff = !insertError

        if (isUniqueViolation(insertError)) {
          const racedLookup = await findCustomerByPhone(client, standardizedPhone, numbersToMatch)
          if (racedLookup.customer) {
            return attachToMatchedCustomer(racedLookup.customer)
          }
          if (racedLookup.lookupError) {
            return { customerId: null, standardizedPhone, resolutionError: 'lookup_failed' }
          }
        }
      }
    }

    if (insertError) {
      console.error('Failed to create customer for SMS logging:', JSON.stringify({
        code: insertError.code ?? null,
        message: insertError.message ?? null,
      }))
      return { customerId: null, standardizedPhone, resolutionError: 'insert_failed' }
    }

    if (typedEmailLeftOff) {
      // console.error, not logger.warn, which is silent in production. Ids only.
      console.error('Customer created without the typed email, which is on another customer', JSON.stringify({
        customerId: inserted?.id ?? null
      }))
    }

    if (heldOptOut && inserted?.id) {
      // The record already starts opted out; this writes the consent history to match. Best
      // effort: the columns above are what every send reads.
      try {
        await ConsentService.recordOptOut(
          inserted.id,
          'sms',
          'twilio_inbound_sms',
          {
            captureMethod: 'inbound_keyword',
            metadata: { unmatched_communication_id: heldOptOut.unmatchedId, keyword: heldOptOut.keyword },
          },
          heldOptOut.scope === 'all' ? ['service', 'marketing'] : ['marketing']
        )
      } catch (error) {
        console.error('Customer created opted out, but the opt-out history was not written', JSON.stringify({
          customerId: inserted.id,
          message: error instanceof Error ? error.message : String(error),
        }))
      }
    }

    return {
      customerId: inserted?.id ?? null,
      standardizedPhone,
      resolvedFirstName: providedFirstName || undefined,
      bookingContactEmail: typedEmailLeftOff ? sanitizedEmail : null
    }
  } catch (error) {
    console.error('Failed to resolve customer for phone:', error)
    return { customerId: null, standardizedPhone: null, resolutionError: 'unexpected_error' }
  }
}

async function validateCustomerIdMatchesPhone(
  client: SupabaseClient<Database, 'public'>,
  input: {
    customerId: string
    standardizedTo: string
    toNumbersToMatch: string[]
  }
): Promise<
  | { ok: true }
  | {
      ok: false
      reason: 'customer_lookup_failed' | 'customer_not_found' | 'customer_phone_mismatch'
    }
> {
  try {
    const { data: customer, error } = await client
      .from('customers')
      .select('id, mobile_e164, mobile_number')
      .eq('id', input.customerId)
      .maybeSingle()

    if (error) {
      console.error('Failed to look up customer by id for SMS safety check:', error)
      return { ok: false, reason: 'customer_lookup_failed' }
    }

    if (!customer) {
      console.error('Customer id lookup affected no rows while resolving SMS recipient', {
        customerId: input.customerId
      })
      return { ok: false, reason: 'customer_not_found' }
    }

    const rawPhones = [
      customer?.mobile_e164,
      customer?.mobile_number
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

    if (rawPhones.length === 0) {
      console.error('Customer record missing phone fields while validating SMS recipient', {
        customerId: input.customerId
      })
      return { ok: false, reason: 'customer_phone_mismatch' }
    }

    const customerVariants = new Set<string>()
    for (const phone of rawPhones) {
      for (const variant of generatePhoneVariants(phone)) {
        customerVariants.add(variant)
      }
    }

    const matches = input.toNumbersToMatch.some(value => customerVariants.has(value))
    if (!matches) {
      // Masked: these are guests' numbers, and logs are read by more people than the records (BK-206).
      logger.error('Provided customerId does not match destination phone for SMS send', {
        metadata: {
          customerId: input.customerId,
          to: maskPhone(input.standardizedTo),
          customerPhones: maskPhones(rawPhones)
        }
      })
      return { ok: false, reason: 'customer_phone_mismatch' }
    }

    return { ok: true }
  } catch (error) {
    console.error('Unexpected failure validating customerId phone match for SMS', error)
    return { ok: false, reason: 'customer_lookup_failed' }
  }
}

export async function resolveCustomerIdForSms(
  supabase: SupabaseClient<Database, 'public'>,
  params: { bookingId?: string; customerId?: string; to: string }
): Promise<{ customerId: string | null; resolutionError?: string }> {
  let standardizedTo: string
  let toNumbersToMatch: string[]
  try {
    standardizedTo = formatPhoneForStorage(params.to)
    const variants = generatePhoneVariants(standardizedTo)
    toNumbersToMatch = variants.length > 0 ? variants : [standardizedTo]
  } catch (error) {
    console.error('Failed to standardize destination phone while resolving customer for SMS:', error)
    return { customerId: null, resolutionError: 'customer_lookup_failed' }
  }

  let bookingContext:
    | { type: 'private'; record: any }
    | null = null

  if (params.bookingId) {
    const { data: privateBooking, error: privateBookingError } = await supabase
      .from('private_bookings')
      .select(
        'id, customer_id, contact_phone, customer_first_name, customer_last_name, customer_name, contact_email'
      )
      .eq('id', params.bookingId)
      .maybeSingle()

    if (privateBookingError) {
      console.error('Failed to resolve private booking context for SMS:', privateBookingError)
      return { customerId: null, resolutionError: 'booking_lookup_failed' }
    }

    if (!privateBooking) {
      console.error('Private booking context missing while resolving customer for SMS', {
        bookingId: params.bookingId
      })
      return { customerId: null, resolutionError: 'booking_not_found' }
    }

    if (privateBooking.contact_phone) {
      try {
        const standardizedContactPhone = formatPhoneForStorage(privateBooking.contact_phone)
        if (standardizedContactPhone !== standardizedTo) {
          logger.error('SMS recipient phone does not match private booking contact phone', {
            metadata: {
              bookingId: privateBooking.id,
              to: maskPhone(standardizedTo),
              contactPhone: maskPhone(standardizedContactPhone)
            }
          })
          return { customerId: null, resolutionError: 'booking_phone_mismatch' }
        }
      } catch (error) {
        logger.error('Failed to standardize private booking contact phone while resolving SMS recipient', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: {
            bookingId: privateBooking.id,
            contactPhone: maskPhone(privateBooking.contact_phone)
          }
        })
        return { customerId: null, resolutionError: 'booking_phone_mismatch' }
      }
    }

    if (privateBooking.customer_id) {
      if (params.customerId && privateBooking.customer_id !== params.customerId) {
        console.error('Provided customerId does not match private booking customer_id for SMS send', {
          bookingId: privateBooking.id,
          bookingCustomerId: privateBooking.customer_id,
          customerId: params.customerId
        })
        return { customerId: null, resolutionError: 'booking_customer_mismatch' }
      }

      const validation = await validateCustomerIdMatchesPhone(supabase, {
        customerId: privateBooking.customer_id,
        standardizedTo,
        toNumbersToMatch
      })
      if (validation.ok) {
        return { customerId: privateBooking.customer_id }
      }
      if (!privateBooking.contact_phone || validation.reason !== 'customer_phone_mismatch') {
        return { customerId: null, resolutionError: validation.reason }
      }

      // BK-163: the booking's contact phone (checked equal to `to` above) is not the linked
      // customer's mobile: staff changed one of them, or the enquiry came from a new number with
      // a known email. Every text used to be refused for that, silently. The contact phone is
      // the number the booking asked us to use, so it is treated as checked, and the consent
      // that counts is that number's own: the customer who holds it, found or recorded now.
      // Their opt-out is honoured by the send as usual. The booking keeps its customer.
      logger.warn('Private booking contact phone differs from the linked customer; texting the number on the booking', {
        metadata: { bookingId: privateBooking.id, to: maskPhone(standardizedTo) }
      })
      try {
        const lookup = await findCustomerByPhone(supabase, standardizedTo, toNumbersToMatch)
        if (lookup.lookupError) {
          return { customerId: null, resolutionError: 'customer_lookup_failed' }
        }
        if (lookup.customer) {
          return { customerId: lookup.customer.id }
        }
        const contactName = privateBooking.customer_first_name
          ? { firstName: privateBooking.customer_first_name, lastName: privateBooking.customer_last_name || undefined }
          : deriveNameParts(privateBooking.customer_name)
        const ensured = await ensureCustomerForPhone(supabase, standardizedTo, {
          firstName: contactName?.firstName,
          lastName: contactName?.lastName,
          // The email belongs to the booker, who may not be the person on this number.
          email: null
        })
        if (ensured.resolutionError || !ensured.customerId) {
          return { customerId: null, resolutionError: ensured.resolutionError ?? 'customer_not_found' }
        }
        return { customerId: ensured.customerId }
      } catch (error) {
        logger.error('Failed to resolve the customer for a private booking contact phone', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: { bookingId: privateBooking.id }
        })
        return { customerId: null, resolutionError: 'customer_lookup_failed' }
      }
    }

    bookingContext = { type: 'private', record: privateBooking }
  }

  const bookingRecord = bookingContext?.record
  const nameFallback = bookingRecord?.customer_first_name || bookingRecord?.customer?.first_name
    ? {
        firstName: bookingRecord.customer_first_name || bookingRecord.customer?.first_name,
        lastName: bookingRecord.customer_last_name || bookingRecord.customer?.last_name || undefined
      }
    : deriveNameParts(bookingRecord?.customer_name)

  const fallbackInfo: CustomerFallback = {
    firstName: nameFallback?.firstName,
    lastName: nameFallback?.lastName,
    email: bookingRecord?.contact_email || bookingRecord?.customer?.email || null
  }

  const phoneToUse = bookingRecord?.contact_phone || bookingRecord?.customer?.mobile_number || params.to

  if (!bookingContext) {
    if (params.customerId) {
      const validation = await validateCustomerIdMatchesPhone(supabase, {
        customerId: params.customerId,
        standardizedTo,
        toNumbersToMatch
      })
      if (!validation.ok) {
        return { customerId: null, resolutionError: validation.reason }
      }

      return { customerId: params.customerId }
    }

    // Manual send path: do not create new customers for arbitrary phone numbers.
    // Only resolve an existing customer, otherwise fail closed so we don't silently
    // expand the SMS-eligible population.
    try {
      const standardizedPhone = formatPhoneForStorage(phoneToUse)
      const variants = generatePhoneVariants(standardizedPhone)
      const numbersToMatch = variants.length > 0 ? variants : [standardizedPhone]

      const lookup = await findCustomerByPhone(supabase, standardizedPhone, numbersToMatch)
      const existingMatch = lookup.customer

      if (lookup.lookupError) {
        return { customerId: null, resolutionError: 'customer_lookup_failed' }
      }

      if (!existingMatch) {
        return { customerId: null, resolutionError: 'customer_not_found' }
      }

      await enrichMatchedCustomer(supabase, {
        existingCustomer: existingMatch,
        standardizedPhone,
        fallbackFirstName: fallbackInfo.firstName,
        fallbackLastName: fallbackInfo.lastName,
        fallbackEmail: fallbackInfo.email
      })

      return { customerId: existingMatch.id }
    } catch (error) {
      console.error('Failed to resolve customer by phone for SMS:', error)
      return { customerId: null, resolutionError: 'customer_lookup_failed' }
    }
  }

  let customerId: string | null = null
  let resolutionError: string | undefined

  if (params.customerId) {
    const validation = await validateCustomerIdMatchesPhone(supabase, {
      customerId: params.customerId,
      standardizedTo,
      toNumbersToMatch
    })
    if (!validation.ok) {
      return { customerId: null, resolutionError: validation.reason }
    }

    customerId = params.customerId
  } else {
    const ensured = await ensureCustomerForPhone(supabase, phoneToUse, fallbackInfo)
    customerId = ensured.customerId
    resolutionError = ensured.resolutionError
  }

  if (resolutionError) {
    return { customerId: customerId ?? null, resolutionError }
  }

  if (customerId && bookingContext) {
    try {
      if (bookingContext.type === 'private') {
        const displayName = fallbackInfo.lastName
          ? `${fallbackInfo.firstName} ${fallbackInfo.lastName}`.trim()
          : fallbackInfo.firstName

        const { data: linkedBooking, error: linkError } = await supabase
          .from('private_bookings')
          .update({
            customer_id: customerId,
            customer_name: displayName || undefined
          })
          .eq('id', bookingContext.record.id)
          .select('id')
          .maybeSingle()

        if (linkError) {
          throw linkError
        }

        if (!linkedBooking) {
          console.warn('Private booking customer-link update affected no rows', {
            bookingId: bookingContext.record.id,
            customerId
          })
        }
      }
    } catch (updateError) {
      console.error('Failed to link booking to customer:', updateError)
    }
  }

  return { customerId }
}
