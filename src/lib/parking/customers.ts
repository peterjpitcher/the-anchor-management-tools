import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'

export interface CustomerResolutionParams {
  firstName: string
  lastName?: string
  email?: string
  phone: string
}

export interface ResolvedCustomer {
  id: string
  first_name: string
  last_name?: string
  mobile_number: string
  email?: string
}

export async function resolveCustomerByPhone(
  supabase: SupabaseClient<any, 'public', any>,
  params: CustomerResolutionParams
): Promise<ResolvedCustomer> {
  const standardizedPhone = formatPhoneForStorage(params.phone)
  const variants = generatePhoneVariants(standardizedPhone)
  const phoneLookupOr = variants.map((v) => `mobile_number.eq.${v}`).join(',')

  const { data: existingCustomer, error: lookupError } = await supabase
    .from('customers')
    .select('*')
    .or(phoneLookupOr)
    .maybeSingle()

  if (lookupError) {
    console.error('Failed to lookup customer by phone', lookupError)
    throw new Error('Failed to lookup customer')
  }

  const emailLower = params.email ? params.email.toLowerCase() : undefined

  if (existingCustomer) {
    const customer = existingCustomer as any
    let resolvedEmail = (customer.email as string | null) || undefined
    let resolvedLastName = (customer.last_name as string | null) || undefined

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

    const lastNameTrimmed = params.lastName?.trim()
    if (lastNameTrimmed && (!customer.last_name || customer.last_name !== lastNameTrimmed)) {
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
      mobile_number: customer.mobile_number as string,
      email: resolvedEmail
    }
  }

  const { data: newCustomer, error: insertError } = await supabase
    .from('customers')
    .insert({
      first_name: params.firstName,
      last_name: params.lastName ?? null,
      mobile_number: standardizedPhone,
      email: emailLower ?? null,
      sms_opt_in: true
    })
    .select()
    .single()

  if (insertError) {
    const pgError = insertError as { code?: string; message?: string }
    if (pgError?.code === '23505') {
      const { data: concurrentCustomer, error: concurrentLookupError } = await supabase
        .from('customers')
        .select('*')
        .or(phoneLookupOr)
        .maybeSingle()

      if (concurrentLookupError) {
        console.error('Failed to load concurrently-created customer', concurrentLookupError)
      } else if (concurrentCustomer?.id) {
        return {
          id: concurrentCustomer.id as string,
          first_name: concurrentCustomer.first_name as string,
          last_name: (concurrentCustomer.last_name as string | null) ?? undefined,
          mobile_number: concurrentCustomer.mobile_number as string,
          email: (concurrentCustomer.email as string | null) ?? undefined
        }
      }
    }

    console.error('Failed to create customer', insertError)
    throw new Error('Failed to create customer')
  }

  return {
    id: newCustomer!.id as string,
    first_name: newCustomer!.first_name as string,
    last_name: (newCustomer!.last_name as string | null) ?? undefined,
    mobile_number: newCustomer!.mobile_number as string,
    email: (newCustomer!.email as string | null) ?? undefined
  }
}
