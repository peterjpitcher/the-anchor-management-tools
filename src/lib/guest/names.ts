import type { SupabaseClient } from '@supabase/supabase-js'

const GUEST_FIRST_NAME_FALLBACK = 'there'

export function normalizeGuestFirstName(value?: string | null): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return GUEST_FIRST_NAME_FALLBACK
  }

  const [first] = trimmed.split(/\s+/)
  if (!first) {
    return GUEST_FIRST_NAME_FALLBACK
  }

  const lower = first.toLowerCase()
  if (lower === 'guest' || lower === 'customer') {
    return GUEST_FIRST_NAME_FALLBACK
  }

  return first
}

export function formatGuestGreeting(firstName: string | null | undefined, message: string): string {
  return `Hi ${normalizeGuestFirstName(firstName)}, ${message}`
}

export async function getCustomerFirstNameById(
  supabase: SupabaseClient<any, 'public', any>,
  customerId?: string | null
): Promise<string> {
  if (!customerId) {
    return GUEST_FIRST_NAME_FALLBACK
  }

  const { data } = await supabase
    .from('customers')
    .select('first_name')
    .eq('id', customerId)
    .maybeSingle()

  return normalizeGuestFirstName(data?.first_name)
}
