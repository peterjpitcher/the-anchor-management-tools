/**
 * What staff must read after a party-size change, from the party-size route's answer (BK-043,
 * customer bookings review of 24 October 2026).
 *
 * The route has always returned a `warning` (a deposit left for a manager) and `preorderRemoved`
 * (the seats whose food choices the shrink dropped), but the FOH iPad read neither and the back
 * office showed the warning as a toast that vanished in seconds, so neither reached anybody. Both
 * screens now keep these lines on screen until staff dismiss them.
 *
 * Pure, with no server imports: the staff screens read it from route responses.
 */

type RemovedSeat = {
  ordinal?: unknown
  guestName?: unknown
  courses?: unknown
}

function describeRemovedSeat(seat: RemovedSeat): string | null {
  const ordinal = Number(seat.ordinal)
  if (!Number.isFinite(ordinal) || ordinal < 1) return null
  const name = typeof seat.guestName === 'string' && seat.guestName.trim() ? ` (${seat.guestName.trim()})` : ''
  const dishes = Array.isArray(seat.courses)
    ? seat.courses
        .map((course) => (course && typeof course === 'object' ? (course as { itemName?: unknown }).itemName : null))
        .filter((dish): dish is string => typeof dish === 'string' && dish.trim().length > 0)
    : []
  return `Seat ${ordinal}${name}: food choices removed${dishes.length > 0 ? ` (${dishes.join(', ')})` : ''}. Tell the booker in case the wrong guest was dropped.`
}

/** The lines to keep on screen, or an empty list when there is nothing to act on. */
export function describePartySizeStaffNotice(result: unknown): string[] {
  const payload = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
  if (!payload) return []

  const lines: string[] = []
  if (typeof payload.warning === 'string' && payload.warning.trim()) {
    lines.push(payload.warning.trim())
  }
  if (Array.isArray(payload.preorderRemoved)) {
    for (const seat of payload.preorderRemoved) {
      const line = seat && typeof seat === 'object' ? describeRemovedSeat(seat as RemovedSeat) : null
      if (line) lines.push(line)
    }
  }
  return lines
}
