import type { SupabaseClient } from '@supabase/supabase-js'

type ParkingSmsEligibility =
  | { allowed: true }
  | {
      allowed: false
      reason: 'customer_lookup_failed' | 'customer_opted_out'
      detail?: string
    }

export async function resolveParkingSmsEligibility(
  supabase: SupabaseClient<any, 'public', any>,
  customerId: string | null | undefined
): Promise<ParkingSmsEligibility> {
  if (!customerId) {
    return { allowed: true }
  }

  const { data, error } = await supabase
    .from('customers')
    .select('sms_opt_in')
    .eq('id', customerId)
    .maybeSingle()

  if (error) {
    return {
      allowed: false,
      reason: 'customer_lookup_failed',
      detail: error.message || 'Failed to load customer SMS preference'
    }
  }

  if (!data) {
    return {
      allowed: false,
      reason: 'customer_lookup_failed',
      detail: 'Customer SMS preference row not found'
    }
  }

  if (data.sms_opt_in === false) {
    return {
      allowed: false,
      reason: 'customer_opted_out'
    }
  }

  return { allowed: true }
}
