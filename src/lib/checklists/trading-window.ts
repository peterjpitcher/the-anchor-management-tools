// src/lib/checklists/trading-window.ts
// Pure trading-window resolver for the checklists engine (spec 5.1).
//
// True field-by-field COALESCE of a day's special_hours row over its business_hours row,
// INCLUDING is_closed. Never fabricates a window: a partial special row (times only,
// is_closed null) inherits the closed flag from business and overrides only the times it
// supplies. Providing times does NOT imply open. The FOH route's hours logic must not be
// reused (it uses row precedence, not COALESCE, and fabricates a fallback window).

import { createAdminClient } from '@/lib/supabase/admin'
import type { HoursRow, TradingWindow } from './types'

/**
 * Resolve the trading window for a single day from a special_hours row (may be null) and a
 * business_hours row (may be null), per the spec 5.1 truth table.
 */
export function coalesceTradingWindow(
  special: HoursRow | null,
  business: HoursRow | null,
): TradingWindow {
  // is_closed coalesces special over business, defaulting to open when neither supplies it.
  const isClosed = special?.is_closed ?? business?.is_closed ?? false

  if (isClosed) {
    // The special row governs only when its own is_closed was non-null.
    const source = special?.is_closed != null ? 'special_hours' : 'business_hours'
    return { isClosed: true, source }
  }

  // Open: coalesce each time field, special over business.
  const opens = special?.opens ?? business?.opens ?? null
  const closes = special?.closes ?? business?.closes ?? null

  if (opens == null || closes == null) {
    return { resolved: false, reason: 'no_hours' }
  }

  if (opens === closes) {
    return { resolved: false, reason: 'invalid_hours' }
  }

  // The special row supplied opens iff its opens was non-null.
  const source = special?.opens != null ? 'special_hours' : 'business_hours'
  return { isClosed: false, opens, closes, source }
}

/**
 * Resolve a business date's trading window from the live hours tables (spec 5.1). Reads the
 * business_hours row for the date's weekday and the special_hours row for the exact date,
 * both via the service-role admin client (checklist reads are deny-all under RLS), then
 * COALESCEs special over business through {@link coalesceTradingWindow}. A query failure
 * returns `{ resolved: false, reason: 'query_error' }` so generation never runs against
 * hours it could not read.
 */
export async function resolveTradingWindow(businessDate: string): Promise<TradingWindow> {
  const db = createAdminClient()

  // UTC getUTCDay so the weekday is derived from the date string alone, never local time.
  const dayOfWeek = new Date(`${businessDate}T00:00:00Z`).getUTCDay()

  const [businessRes, specialRes] = await Promise.all([
    db
      .from('business_hours')
      .select('opens, closes, is_closed')
      .eq('day_of_week', dayOfWeek)
      .maybeSingle(),
    db
      .from('special_hours')
      .select('opens, closes, is_closed')
      .eq('date', businessDate)
      .maybeSingle(),
  ])

  if (businessRes.error || specialRes.error) {
    return { resolved: false, reason: 'query_error' }
  }

  const business = (businessRes.data as HoursRow | null) ?? null
  const special = (specialRes.data as HoursRow | null) ?? null
  return coalesceTradingWindow(special, business)
}
