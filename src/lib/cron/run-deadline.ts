/**
 * A time limit a long scheduled job checks between pieces of work (BK-212, customer bookings
 * review of 24 October 2026).
 *
 * Vercel stops a function at its maxDuration without warning, so a job cut off half way leaves
 * no record of what it did not reach. A job that asks `timeIsUp` before each booking stops
 * itself a little before that limit instead, and `summary()` says which stages it stopped in and
 * how many items each had left, for the run record and the alert.
 */

export type RunDeadlineSkip = {
  stage: string
  /** Items the stage had not reached, or null when the whole stage was skipped. */
  items: number | null
}

export type RunDeadlineSummary = {
  stoppedIn: string
  skipped: RunDeadlineSkip[]
}

export type RunDeadline = {
  /**
   * True once the deadline has passed. The first call that sees it records where the run
   * stopped; each call that returns true records its stage and what that stage had left (a
   * number, or a function giving it, called only when time is up).
   */
  timeIsUp(stage: string, itemsLeft?: number | null | (() => number)): boolean
  /** True when any call has reported the deadline passed. */
  readonly reached: boolean
  /** What was skipped, or null when the run finished in time. */
  summary(): RunDeadlineSummary | null
}

export function createRunDeadline(deadlineAt: number, now: () => number = Date.now): RunDeadline {
  let stoppedIn: string | null = null
  const skipped: RunDeadlineSkip[] = []

  return {
    timeIsUp(stage: string, itemsLeft: number | null | (() => number) = null): boolean {
      if (stoppedIn === null && now() < deadlineAt) return false
      if (stoppedIn === null) stoppedIn = stage
      // A function is only called once time is up, so a loop can pass an indexOf without paying
      // for it on every item.
      const left = typeof itemsLeft === 'function' ? itemsLeft() : itemsLeft
      const items = typeof left === 'number' && Number.isFinite(left) ? Math.max(0, Math.floor(left)) : null
      const existing = skipped.find((entry) => entry.stage === stage)
      if (!existing) skipped.push({ stage, items })
      return true
    },
    get reached(): boolean {
      return stoppedIn !== null
    },
    summary(): RunDeadlineSummary | null {
      return stoppedIn === null ? null : { stoppedIn, skipped: skipped.map((entry) => ({ ...entry })) }
    },
  }
}
