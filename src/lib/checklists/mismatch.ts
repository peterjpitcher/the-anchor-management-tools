// src/lib/checklists/mismatch.ts
// Pure hours-mismatch detector (spec §8). Compares a day's expected trading window against
// the earliest/latest rostered instants and flags cover gaps. No I/O, no dates parsed here:
// callers pass already-resolved instants (spec §5.3).

export type MismatchKind = 'no_cover_at_open' | 'no_cover_at_close' | 'rota_before_open'

export interface MismatchInput {
  opensAt: Date
  closesAt: Date
  earliestStartAt: Date | null
  latestEndAt: Date | null
  earlyThresholdMinutes: number
  thresholdMinutes: number
}

export interface Mismatch {
  kind: MismatchKind
  minutes: number
}

/** Minutes between two instants: positive when `a` is later than `b`. */
function diffMinutes(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / 60000
}

/**
 * Detect hours mismatches for a single trading day (spec §8).
 *
 * - no_cover_at_open: earliest start is null, or later than open by more than `thresholdMinutes`.
 * - no_cover_at_close: latest end is null, or earlier than close by more than `thresholdMinutes`.
 * - rota_before_open: earliest start is earlier than open by strictly more than `earlyThresholdMinutes`.
 *
 * Returns every kind that applies; `minutes` is the gap magnitude (0 when derived from a null).
 */
export function detectMismatches(input: MismatchInput): Mismatch[] {
  const { opensAt, closesAt, earliestStartAt, latestEndAt, earlyThresholdMinutes, thresholdMinutes } = input
  const results: Mismatch[] = []

  // no_cover_at_open: nobody covers the open, or first cover arrives too late.
  if (earliestStartAt === null) {
    results.push({ kind: 'no_cover_at_open', minutes: 0 })
  } else {
    const lateBy = diffMinutes(earliestStartAt, opensAt)
    if (lateBy > thresholdMinutes) {
      results.push({ kind: 'no_cover_at_open', minutes: lateBy })
    }
  }

  // no_cover_at_close: nobody covers the close, or last cover leaves too early.
  if (latestEndAt === null) {
    results.push({ kind: 'no_cover_at_close', minutes: 0 })
  } else {
    const earlyBy = diffMinutes(closesAt, latestEndAt)
    if (earlyBy > thresholdMinutes) {
      results.push({ kind: 'no_cover_at_close', minutes: earlyBy })
    }
  }

  // rota_before_open: someone rostered well before open (strict, so the 10:30 cleaning shift
  // exactly 90 min before a 12:00 open is by design and does not trigger).
  if (earliestStartAt !== null) {
    const earlyBy = diffMinutes(opensAt, earliestStartAt)
    if (earlyBy > earlyThresholdMinutes) {
      results.push({ kind: 'rota_before_open', minutes: earlyBy })
    }
  }

  return results
}
