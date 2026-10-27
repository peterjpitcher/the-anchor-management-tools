import { fohBookingBypassesPacing } from '@/lib/foh/pacing-bypass'

/**
 * The inputs of the FOH free-times check (BK-184), parsed from a query string. Shared by the route
 * and its tests so the two cannot read the form differently.
 */
export type FohAvailabilityQuery = {
  date: string
  partySize: number
  /** What check_table_availability_v06 understands: a Christmas booking is a food booking. */
  purpose: 'food' | 'drinks'
  outside: boolean
  requiresAccessibleTable: boolean
  highChairCount: number
  /** Never taken from the caller as such: 'walkin' for a walk-in, otherwise 'staff'. */
  channel: 'staff' | 'walkin'
  /** Saving this booking skips kitchen pacing and the drinks ceiling, as the create route does. */
  bypassPacing: boolean
}

export function parseFohAvailabilityQuery(
  params: URLSearchParams
): { ok: true; value: FohAvailabilityQuery } | { ok: false; error: string } {
  const date = params.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'Date must use YYYY-MM-DD format' }
  }
  const partySize = Number.parseInt(params.get('party_size') ?? '', 10)
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 200) {
    return { ok: false, error: 'Party size must be a whole number of guests' }
  }
  const rawPurpose = params.get('purpose') ?? 'food'
  if (!['food', 'drinks', 'christmas'].includes(rawPurpose)) {
    return { ok: false, error: 'Purpose must be food, drinks or christmas' }
  }
  const highChairCount = Math.max(0, Math.min(2, Number.parseInt(params.get('high_chair_count') ?? '0', 10) || 0))
  return {
    ok: true,
    value: {
      date,
      partySize,
      purpose: rawPurpose === 'drinks' ? 'drinks' : 'food',
      outside: params.get('outside') === 'true',
      requiresAccessibleTable: params.get('requires_accessible_table') === 'true',
      highChairCount,
      channel: params.get('walk_in') === 'true' ? 'walkin' : 'staff',
      bypassPacing: fohBookingBypassesPacing({ walkIn: params.get('walk_in') === 'true', purpose: rawPurpose }),
    },
  }
}

/** The public reasons that come only from the arrival limits a FOH walk-in or drinks booking skips. */
const PACING_REASONS = new Set(['kitchen_full', 'drinks_full'])

type AvailabilitySlot = { state?: string; public_reason?: string | null; message?: string | null; [key: string]: unknown }

/**
 * The slot list as the FOH create route would honour it. check_table_availability_v06 judges the
 * arrival limits (kitchen pacing for food, the drinks ceiling for drinks) only for a time that
 * already has a table and is open, so a time refused for one of them would save once the limit is
 * skipped. For a booking that skips them (fohBookingBypassesPacing) those times are offered; every
 * other refusal stands.
 */
export function withPacingBypass<T extends { slots?: AvailabilitySlot[] }>(answer: T, bypassPacing: boolean): T {
  if (!bypassPacing || !Array.isArray(answer?.slots)) return answer
  return {
    ...answer,
    slots: answer.slots.map((slot) =>
      slot.state === 'unavailable' && PACING_REASONS.has(String(slot.public_reason))
        ? { ...slot, state: 'available', public_reason: null, message: null }
        : slot
    ),
  }
}

/** Staff wording for a time that is not free, from the slot list's public reason. */
export function describeFohSlotReason(publicReason: string | null | undefined): string {
  switch (publicReason) {
    case 'tables_full':
      return 'No table that fits'
    case 'kitchen_full':
      return 'Kitchen pacing full'
    case 'drinks_full':
      return 'Drinks arrivals full'
    case 'outside_full':
      return 'Outside tables full'
    case 'closed':
      return 'Closed or passed'
    case 'too_late':
      return 'Too close to closing'
    case 'too_large':
      return 'Party too large'
    default:
      return 'Not available'
  }
}
