import type { SupabaseClient } from '@supabase/supabase-js'
import { hashGuestToken } from '@/lib/guest/tokens'

const TABLE_PAYMENT_PATH_REGEX = /^\/g\/([^/]+)\/table-payment\/?$/i

export type ParsedTablePaymentLink = {
  rawToken: string
  tokenHash: string
}

export type TablePaymentGuestTokenRow = {
  id: string
  customer_id: string | null
  table_booking_id: string | null
  expires_at: string | null
  consumed_at: string | null
}

export function parseTablePaymentTokenFromPath(pathname: string): string | null {
  const match = pathname.match(TABLE_PAYMENT_PATH_REGEX)
  if (!match?.[1]) {
    return null
  }

  try {
    const decoded = decodeURIComponent(match[1]).trim()
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

export function parseTablePaymentLinkFromUrl(url: URL): ParsedTablePaymentLink | null {
  const rawToken = parseTablePaymentTokenFromPath(url.pathname)
  if (!rawToken) {
    return null
  }

  return {
    rawToken,
    tokenHash: hashGuestToken(rawToken),
  }
}

export async function getTablePaymentGuestTokenByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<TablePaymentGuestTokenRow | null> {
  const tokenHash = hashGuestToken(rawToken)

  const { data, error } = await supabase
    .from('guest_tokens')
    .select('id, customer_id, table_booking_id, expires_at, consumed_at')
    .eq('hashed_token', tokenHash)
    .eq('action_type', 'payment')
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data || null) as TablePaymentGuestTokenRow | null
}
