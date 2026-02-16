import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'
import type { SupabaseClient } from '@supabase/supabase-js'

type CustomerFallback = {
  firstName?: string
  lastName?: string
  email?: string | null
}

type ResolvedCustomerResult = {
  customerId: string | null
  standardizedPhone?: string | null
  resolutionError?: string
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

function isPlaceholderFirstName(value: string | null | undefined): boolean {
  const cleaned = value?.trim().toLowerCase()
  return !cleaned || cleaned === 'unknown'
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
  client: SupabaseClient<any, 'public', any>,
  input: {
    existingCustomer: CustomerLookupRow
    standardizedPhone: string
    fallbackFirstName?: string
    fallbackLastName?: string
    fallbackEmail?: string | null
  }
): Promise<void> {
  const updatePayload: Record<string, string> = {}

  if (!input.existingCustomer.mobile_e164) {
    updatePayload.mobile_e164 = input.standardizedPhone
  }

  if (input.fallbackFirstName && isPlaceholderFirstName(input.existingCustomer.first_name)) {
    updatePayload.first_name = input.fallbackFirstName
  }

  if (input.fallbackLastName && isPlaceholderLastName(input.existingCustomer.last_name)) {
    updatePayload.last_name = input.fallbackLastName
  }

  if (input.fallbackEmail && !input.existingCustomer.email?.trim()) {
    updatePayload.email = input.fallbackEmail
  }

  if (Object.keys(updatePayload).length === 0) {
    return
  }

  const { data: updatedCustomer, error } = await client
    .from('customers')
    .update(updatePayload)
    .eq('id', input.existingCustomer.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Failed to enrich existing customer profile:', error)
  } else if (!updatedCustomer) {
    console.warn('Customer enrichment update affected no rows', {
      customerId: input.existingCustomer.id
    })
  }
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
  client: SupabaseClient<any, 'public', any>,
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

export async function ensureCustomerForPhone(
  supabase: SupabaseClient<any, 'public', any> | undefined,
  phone: string | null | undefined,
  fallback: CustomerFallback = {}
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

    const lookup = await findCustomerByPhone(client, standardizedPhone, numbersToMatch)
    const existingMatch = lookup.customer
    if (existingMatch) {
      await enrichMatchedCustomer(client, {
        existingCustomer: existingMatch,
        standardizedPhone,
        fallbackFirstName: providedFirstName,
        fallbackLastName: providedLastName,
        fallbackEmail: sanitizedEmail
      })

      return { customerId: existingMatch.id, standardizedPhone }
    }

    if (lookup.lookupError) {
      // Fail closed when customer safety lookups are unavailable.
      return { customerId: null, standardizedPhone, resolutionError: 'lookup_failed' }
    }

    const fallbackFirstName = providedFirstName
      ? providedFirstName
      : 'Unknown'

    // Keep fallbacks compatible with customer validation rules (letters/spaces/-/').
    // Numeric placeholders (e.g. last 4 digits) break `/customers` updates.
    const fallbackLastName = providedLastName
      ? providedLastName
      : 'Guest'

    const insertPayload = {
      first_name: fallbackFirstName,
      last_name: fallbackLastName,
      mobile_number: standardizedPhone,
      mobile_e164: standardizedPhone,
      email: sanitizedEmail,
      sms_opt_in: true,
      sms_status: 'active'
    }

    const { data: inserted, error: insertError } = await client
      .from('customers')
      .insert(insertPayload)
      .select('id')
      .single()

    if (insertError) {
      if ((insertError as any)?.code === '23505') {
        const conflictLookup = await findCustomerByPhone(client, standardizedPhone, numbersToMatch)
        const conflictMatch = conflictLookup.customer
        if (conflictMatch) {
          await enrichMatchedCustomer(client, {
            existingCustomer: conflictMatch,
            standardizedPhone,
            fallbackFirstName: providedFirstName,
            fallbackLastName: providedLastName,
            fallbackEmail: sanitizedEmail
          })

          return { customerId: conflictMatch.id, standardizedPhone }
        }

        if (conflictLookup.lookupError) {
          return { customerId: null, standardizedPhone, resolutionError: 'lookup_failed' }
        }
      }

      console.error('Failed to create customer for SMS logging:', insertError)
      return { customerId: null, standardizedPhone, resolutionError: 'insert_failed' }
    }

    return { customerId: inserted?.id ?? null, standardizedPhone }
  } catch (error) {
    console.error('Failed to resolve customer for phone:', error)
    return { customerId: null, standardizedPhone: null, resolutionError: 'unexpected_error' }
  }
}

async function validateCustomerIdMatchesPhone(
  client: SupabaseClient<any, 'public', any>,
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
      (customer as any)?.mobile_e164,
      (customer as any)?.mobile_number
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
      console.error('Provided customerId does not match destination phone for SMS send', {
        customerId: input.customerId,
        to: input.standardizedTo,
        customerPhones: rawPhones
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
  supabase: SupabaseClient<any, 'public', any>,
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
          console.error('SMS recipient phone does not match private booking contact phone', {
            bookingId: privateBooking.id,
            to: standardizedTo,
            contactPhone: standardizedContactPhone
          })
          return { customerId: null, resolutionError: 'booking_phone_mismatch' }
        }
      } catch (error) {
        console.error('Failed to standardize private booking contact phone while resolving SMS recipient', {
          bookingId: privateBooking.id,
          contactPhone: privateBooking.contact_phone,
          error
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

      if (!privateBooking.contact_phone) {
        const validation = await validateCustomerIdMatchesPhone(supabase, {
          customerId: privateBooking.customer_id,
          standardizedTo,
          toNumbersToMatch
        })
        if (!validation.ok) {
          return { customerId: null, resolutionError: validation.reason }
        }
      }

      return { customerId: privateBooking.customer_id }
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
            customer_name: displayName || null
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
