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
}

type CustomerLookupRow = {
  id: string
  mobile_e164: string | null
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
): Promise<CustomerLookupRow | null> {
  const { data: canonicalMatches, error: canonicalLookupError } = await client
    .from('customers')
    .select('id, mobile_e164')
    .eq('mobile_e164', standardizedPhone)
    .order('created_at', { ascending: true })
    .limit(1)

  if (canonicalLookupError) {
    console.error('Failed to look up customer by mobile_e164:', canonicalLookupError)
  } else if (canonicalMatches && canonicalMatches.length > 0) {
    return canonicalMatches[0] as CustomerLookupRow
  }

  const { data: legacyMatches, error: legacyLookupError } = await client
    .from('customers')
    .select('id, mobile_e164')
    .in('mobile_number', numbersToMatch)
    .order('created_at', { ascending: true })
    .limit(1)

  if (legacyLookupError) {
    console.error('Failed to look up customer by legacy mobile_number:', legacyLookupError)
    return null
  }

  return legacyMatches && legacyMatches.length > 0
    ? (legacyMatches[0] as CustomerLookupRow)
    : null
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

    const existingMatch = await findCustomerByPhone(client, standardizedPhone, numbersToMatch)
    if (existingMatch) {
      if (!existingMatch.mobile_e164) {
        await client
          .from('customers')
          .update({
            mobile_e164: standardizedPhone
          })
          .eq('id', existingMatch.id)
      }

      return { customerId: existingMatch.id, standardizedPhone }
    }

    const sanitizedFirstName = fallback.firstName?.trim()
    const sanitizedLastName = fallback.lastName?.trim()

    const fallbackFirstName = sanitizedFirstName && sanitizedFirstName.length > 0
      ? sanitizedFirstName
      : 'Unknown'

    let fallbackLastName = sanitizedLastName && sanitizedLastName.length > 0
      ? sanitizedLastName
      : null

    if (!fallbackLastName) {
      const digits = standardizedPhone.replace(/\D/g, '')
      fallbackLastName = digits.length >= 4 ? digits.slice(-4) : 'Contact'
    }

    const insertPayload = {
      first_name: fallbackFirstName,
      last_name: fallbackLastName,
      mobile_number: standardizedPhone,
      mobile_e164: standardizedPhone,
      email: fallback.email ?? null,
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
        const conflictMatch = await findCustomerByPhone(client, standardizedPhone, numbersToMatch)
        if (conflictMatch) {
          if (!conflictMatch.mobile_e164) {
            await client
              .from('customers')
              .update({
                mobile_e164: standardizedPhone
              })
              .eq('id', conflictMatch.id)
          }

          return { customerId: conflictMatch.id, standardizedPhone }
        }
      }

      console.error('Failed to create customer for SMS logging:', insertError)
      return { customerId: null, standardizedPhone }
    }

    return { customerId: inserted?.id ?? null, standardizedPhone }
  } catch (error) {
    console.error('Failed to resolve customer for phone:', error)
    return { customerId: null, standardizedPhone: null }
  }
}

export async function resolveCustomerIdForSms(
  supabase: SupabaseClient<any, 'public', any>,
  params: { bookingId?: string; customerId?: string; to: string }
): Promise<{ customerId: string | null }> {
  if (params.customerId) {
    return { customerId: params.customerId }
  }

  let bookingContext:
    | { type: 'private'; record: any }
    | null = null

  if (params.bookingId) {
    const { data: privateBooking } = await supabase
      .from('private_bookings')
      .select(
        'id, customer_id, contact_phone, customer_first_name, customer_last_name, customer_name, contact_email'
      )
      .eq('id', params.bookingId)
      .maybeSingle()

    if (privateBooking) {
      if (privateBooking.customer_id) {
        return { customerId: privateBooking.customer_id }
      }

      bookingContext = { type: 'private', record: privateBooking }
    }
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

  const { customerId } = await ensureCustomerForPhone(supabase, phoneToUse, fallbackInfo)

  if (customerId && bookingContext) {
    try {
      if (bookingContext.type === 'private') {
        const displayName = fallbackInfo.lastName
          ? `${fallbackInfo.firstName} ${fallbackInfo.lastName}`.trim()
          : fallbackInfo.firstName

        await supabase
          .from('private_bookings')
          .update({
            customer_id: customerId,
            customer_name: displayName || null
          })
          .eq('id', bookingContext.record.id)
      }
    } catch (updateError) {
      console.error('Failed to link booking to customer:', updateError)
    }
  }

  return { customerId }
}
