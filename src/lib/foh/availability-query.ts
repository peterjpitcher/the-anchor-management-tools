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
    },
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
