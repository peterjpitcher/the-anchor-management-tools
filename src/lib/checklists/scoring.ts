// src/lib/checklists/scoring.ts
// Per-person timeliness scoring (spec 7). Pure function, no I/O.
// Each completed instance scores 10 if done on or before its grace deadline, else 5.
// The person's score is the average of those points, banded green/amber/red.
// Scores are suppressed (null) below the minimum sample size so a handful of
// instances can never produce a misleading rating.

import type { Band, ScoredInstance, TimelinessResult } from './types'

/** Minimum completed instances before a score is published (spec 7). */
const MIN_SAMPLE = 30

/** Points awarded for an on-time completion. */
const ON_TIME_POINTS = 10

/** Points awarded for a late completion. */
const LATE_POINTS = 5

/** Map an average score to its band. green >= 9.6, amber 7.6..9.5, red <= 7.5 (spec 7). */
function bandFor(score: number): Band {
  if (score >= 9.6) return 'green'
  if (score >= 7.6) return 'amber'
  return 'red'
}

/**
 * Score one person's completed instances for timeliness (spec 7).
 *
 * On time when `completedAt <= graceUntil` (boundary equal counts as on time).
 * Returns the average points and its band, or a suppressed result (`score`/`band`
 * null) when fewer than MIN_SAMPLE instances are supplied. `count` is always the
 * real number of instances.
 */
export function scoreTimeliness(instances: ScoredInstance[]): TimelinessResult {
  const count = instances.length

  if (count < MIN_SAMPLE) {
    return { score: null, count, band: null }
  }

  const total = instances.reduce((sum, instance) => {
    const onTime = instance.completedAt.getTime() <= instance.graceUntil.getTime()
    return sum + (onTime ? ON_TIME_POINTS : LATE_POINTS)
  }, 0)

  const score = total / count

  return { score, count, band: bandFor(score) }
}
