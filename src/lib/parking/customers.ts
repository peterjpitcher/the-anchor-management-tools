import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'

export interface CustomerResolutionParams {
  firstName: string
  lastName?: string
  email?: string
  phone: string
  defaultCountryCode?: string
}

export interface ResolvedCustomer {
  id: string
  first_name: string
  last_name?: string
  mobile_number: string
  email?: string
}

type CustomerLookupRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
  email: string | null
}

function sanitizeEmail(email?: string): string | undefined {
  if (!email) return undefined
  const normalized = email.trim().toLowerCase()
  return normalized.length > 0 ? normalized : undefined
}

function sanitizeLastName(lastName?: string): string | undefined {
  if (!lastName) return undefined
  const normalized = lastName.trim()
  return normalized.length > 0 ? normalized : undefined
}

async function lookupCustomerByPhone(
  supabase: SupabaseClient<any, 'public', any>,
  standardizedPhone: string,
  variants: string[]
): Promise<CustomerLookupRow | null> {
  const { data: canonicalMatches, error: canonicalLookupError } = await supabase
    .from('customers')
    .select('*')
    .eq('mobile_e164', standardizedPhone)
    .order('created_at', { ascending: true })
    .limit(1)

  if (canonicalLookupError) {
    console.error('Failed to lookup customer by canonical phone', canonicalLookupError)
    throw new Error('Failed to lookup customer')
  }

  if (canonicalMatches && canonicalMatches.length > 0) {
    return canonicalMatches[0] as CustomerLookupRow
  }

  const { data: legacyMatches, error: legacyLookupError } = await supabase
    .from('customers')
    .select('*')
    .in('mobile_number', variants)
    .order('created_at', { ascending: true })
    .limit(1)

  if (legacyLookupError) {
    console.error('Failed to lookup customer by legacy phone variants', legacyLookupError)
    throw new Error('Failed to lookup customer')
  }

  return legacyMatches && legacyMatches.length > 0 ? (legacyMatches[0] as CustomerLookupRow) : null
}

// Postgres names the index in a unique violation's message:
// duplicate key value violates unique constraint "idx_customers_email_unique"
const CUSTOMER_EMAIL_UNIQUE_INDEX = 'idx_customers_email_unique'

type InsertError = { code?: string; message?: string } | null

function isUniqueViolation(error: InsertError): boolean {
  return error?.code === '23505'
}

function violatesCustomerEmailIndex(error: InsertError): boolean {
  return isUniqueViolation(error) && Boolean(error?.message?.includes(`"${CUSTOMER_EMAIL_UNIQUE_INDEX}"`))
}

/**
 * After a unique violation on insert: the customer a concurrent request created
 * for this mobile, or null when there is none.
 */
async function findConcurrentlyCreatedCustomer(
  supabase: SupabaseClient<any, 'public', any>,
  standardizedPhone: string,
  variants: string[]
): Promise<ResolvedCustomer | null> {
  try {
    const concurrentCustomer = await lookupCustomerByPhone(supabase, standardizedPhone, variants)
    if (concurrentCustomer?.id) {
      return {
        id: concurrentCustomer.id as string,
        first_name: concurrentCustomer.first_name as string,
        last_name: (concurrentCustomer.last_name as string | null) ?? undefined,
        mobile_number:
          (concurrentCustomer.mobile_number as string | null) || standardizedPhone,
        email: (concurrentCustomer.email as string | null) ?? undefined
      }
    }
  } catch (concurrentLookupError) {
    console.error('Failed to load concurrently-created customer', concurrentLookupError)
  }

  const fallbackLookup = await supabase
    .from('customers')
    .select('*')
    .in('mobile_number', variants)
    .order('created_at', { ascending: true })
    .limit(1)

  if (fallbackLookup.error) {
    console.error('Failed fallback lookup for concurrently-created customer', fallbackLookup.error)
  } else if (fallbackLookup.data && fallbackLookup.data.length > 0) {
    const fallbackCustomer = fallbackLookup.data[0] as CustomerLookupRow
    return {
      id: fallbackCustomer.id as string,
      first_name: fallbackCustomer.first_name as string,
      last_name: (fallbackCustomer.last_name as string | null) ?? undefined,
      mobile_number: (fallbackCustomer.mobile_number as string | null) || standardizedPhone,
      email: (fallbackCustomer.email as string | null) ?? undefined
    }
  }

  return null
}

export async function resolveCustomerByPhone(
  supabase: SupabaseClient<any, 'public', any>,
  params: CustomerResolutionParams
): Promise<ResolvedCustomer> {
  const standardizedPhone = formatPhoneForStorage(params.phone, {
    defaultCountryCode: params.defaultCountryCode
  })
  const variants = generatePhoneVariants(standardizedPhone)
  const emailLower = sanitizeEmail(params.email)
  const lastNameTrimmed = sanitizeLastName(params.lastName)
  const existingCustomer = await lookupCustomerByPhone(supabase, standardizedPhone, variants)

  if (existingCustomer) {
    const customer = existingCustomer
    let resolvedEmail = (customer.email as string | null) || undefined
    let resolvedLastName = (customer.last_name as string | null) || undefined

    if (!customer.mobile_e164) {
      const { data: updatedPhoneRow, error: phoneUpdateError } = await supabase
        .from('customers')
        .update({ mobile_e164: standardizedPhone })
        .eq('id', customer.id)
        .select('id')
        .maybeSingle()

      if (phoneUpdateError) {
        console.warn('Failed to enrich customer canonical phone during parking customer resolution', {
          customerId: customer.id,
          error: phoneUpdateError.message
        })
      } else if (!updatedPhoneRow) {
        console.warn('Customer canonical-phone enrichment affected no rows during parking customer resolution', {
          customerId: customer.id
        })
      }
    }

    if (!customer.email && emailLower) {
      const { data: updatedEmailRow, error: emailUpdateError } = await supabase
        .from('customers')
        .update({ email: emailLower })
        .eq('id', customer.id)
        .select('id')
        .maybeSingle()

      if (emailUpdateError) {
        console.warn('Failed to enrich customer email during parking customer resolution', {
          customerId: customer.id,
          error: emailUpdateError.message
        })
      } else if (!updatedEmailRow) {
        console.warn('Customer email enrichment affected no rows during parking customer resolution', {
          customerId: customer.id
        })
      } else {
        resolvedEmail = emailLower
      }
    }

    // A surname already on file is never changed from here. This runs for the
    // public parking form, where the only thing tying the request to this
    // customer is a mobile number somebody typed, so "Smith" could become
    // anything for anyone whose number is known. The typed name goes on the
    // booking (see createPendingParkingBooking); the customer record is
    // corrected from the staff screens. A blank surname is still filled in.
    // Site review of 7 October 2026, findings PY-002 and PY-022.
    if (lastNameTrimmed && !sanitizeLastName(customer.last_name ?? undefined)) {
      const { data: updatedLastNameRow, error: lastNameUpdateError } = await supabase
        .from('customers')
        .update({ last_name: lastNameTrimmed })
        .eq('id', customer.id)
        .select('id')
        .maybeSingle()

      if (lastNameUpdateError) {
        console.warn('Failed to enrich customer last name during parking customer resolution', {
          customerId: customer.id,
          error: lastNameUpdateError.message
        })
      } else if (!updatedLastNameRow) {
        console.warn('Customer last-name enrichment affected no rows during parking customer resolution', {
          customerId: customer.id
        })
      } else {
        resolvedLastName = lastNameTrimmed
      }
    }

    return {
      id: customer.id as string,
      first_name: customer.first_name as string,
      last_name: resolvedLastName,
      mobile_number: customer.mobile_number || standardizedPhone,
      email: resolvedEmail
    }
  }

  const newCustomerRow = {
    first_name: params.firstName,
    last_name: lastNameTrimmed ?? null,
    mobile_number: standardizedPhone,
    mobile_e164: standardizedPhone,
    email: emailLower ?? null,
    sms_opt_in: true,
    sms_status: 'active',
    marketing_sms_opt_in: false,
    whatsapp_opt_in: true,
    whatsapp_status: 'active',
    marketing_whatsapp_opt_in: false,
    marketing_email_opt_in: false
  }
  const insertCustomer = (row: typeof newCustomerRow) =>
    supabase.from('customers').insert(row).select().single()

  let created = await insertCustomer(newCustomerRow)

  if (isUniqueViolation(created.error)) {
    const concurrentCustomer = await findConcurrentlyCreatedCustomer(supabase, standardizedPhone, variants)
    if (concurrentCustomer) {
      return concurrentCustomer
    }

    // Nobody has this mobile. A clash on the email index means the typed email
    // is on another customer's record, which is left as it is. Booking under
    // that customer would put their stored mobile on the booking, so the
    // guest's texts would go to someone else's number, and the parking_bookings
    // trigger would copy their name across. The mobile gets a customer of its
    // own without the email, and the booking still carries the typed email.
    // Until 19 October 2026 this threw and the website told the guest to phone.
    if (emailLower && violatesCustomerEmailIndex(created.error)) {
      created = await insertCustomer({ ...newCustomerRow, email: null })

      if (isUniqueViolation(created.error)) {
        const racedCustomer = await findConcurrentlyCreatedCustomer(supabase, standardizedPhone, variants)
        if (racedCustomer) {
          return racedCustomer
        }
      } else if (!created.error) {
        console.warn('Parking customer created without the typed email, which is on another customer', {
          customerId: created.data?.id
        })
      }
    }
  }

  if (created.error) {
    console.error('Failed to create customer', created.error)
    throw new Error('Failed to create customer')
  }

  const newCustomer = created.data
  return {
    id: newCustomer!.id as string,
    first_name: newCustomer!.first_name as string,
    last_name: (newCustomer!.last_name as string | null) ?? undefined,
    mobile_number: (newCustomer!.mobile_number as string | null) || standardizedPhone,
    email: (newCustomer!.email as string | null) ?? undefined
  }
}
