import type { SupabaseClient } from '@supabase/supabase-js'
import { hashGuestToken } from '@/lib/guest/tokens'
import { logger } from '@/lib/logger'

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

function parseTablePaymentTokenFromPath(pathname: string): string | null {
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

/**
 * Moves the guest's unused payment links on to a hold that has just been moved later, so a link
 * never dies before the hold it pays against (R11). A payment token is minted to expire with the
 * hold (createTablePaymentToken), so a hold pushed back without this left the guest holding a dead
 * link to a live booking. Only ever lengthens: a token that already runs later is left alone.
 *
 * Never throws. A failure is logged as an error, because the guest's link will stop working early.
 */
export async function extendTablePaymentTokensToHold(
  supabase: SupabaseClient<any, 'public', any>,
  input: { tableBookingId: string; holdExpiresAtIso: string }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('guest_tokens')
      .update({ expires_at: input.holdExpiresAtIso })
      .eq('table_booking_id', input.tableBookingId)
      .eq('action_type', 'payment')
      .is('consumed_at', null)
      .lt('expires_at', input.holdExpiresAtIso)
    if (error) throw error
    return true
  } catch (error) {
    logger.error('A deposit hold moved later but its payment links could not follow', {
      error: error instanceof Error ? error : new Error(String((error as { message?: string })?.message ?? error)),
      metadata: { tableBookingId: input.tableBookingId },
    })
    return false
  }
}
