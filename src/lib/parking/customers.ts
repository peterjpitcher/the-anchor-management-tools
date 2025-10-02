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

  const { data: existingCustomer, error: lookupError } = await supabase
    .from('customers')
    .select('*')
    .or(variants.map((v) => `mobile_number.eq.${v}`).join(','))
    .maybeSingle()

  if (lookupError) {
    console.error('Failed to lookup customer by phone', lookupError)
    throw new Error('Failed to lookup customer')
  }

  const emailLower = params.email ? params.email.toLowerCase() : undefined

  if (existingCustomer) {
    const customer = existingCustomer as any

    if (!customer.email && emailLower) {
      await supabase
        .from('customers')
        .update({ email: emailLower })
        .eq('id', customer.id)
    }

    return {
      id: customer.id as string,
      first_name: customer.first_name as string,
      last_name: (customer.last_name as string | null) ?? undefined,
      mobile_number: customer.mobile_number as string,
      email: emailLower || (customer.email as string | null) || undefined
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
    console.error('Failed to create customer', insertError)
    throw new Error(insertError.message)
  }

  return {
    id: newCustomer!.id as string,
    first_name: newCustomer!.first_name as string,
    last_name: (newCustomer!.last_name as string | null) ?? undefined,
    mobile_number: newCustomer!.mobile_number as string,
    email: (newCustomer!.email as string | null) ?? undefined
  }
}
