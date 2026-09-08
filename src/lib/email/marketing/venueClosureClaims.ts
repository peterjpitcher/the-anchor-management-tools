/**
 * Guards against copy that tells a reader the pub is shut when it is not.
 *
 * The bug this exists for: "We are open from midday every day except Monday". Every fact in
 * that sentence is true. The bar does open at midday Tuesday to Sunday, and Monday is the
 * exception. But "every day except Monday" attaches the exception to "open" rather than to
 * "from midday", so it reads as "we are shut on Mondays", and we are not: we open at 4pm.
 *
 * The lesson is that this is a PHRASING fault, not a factual one, which is why checking the
 * copy against the hours records would not have caught it. So there are two rules here and
 * they are deliberately different in kind.
 *
 * EXCEPTION PHRASING is always wrong and needs no data. An exception hung off a weekday
 * ("except Monday", "apart from Sundays") is ambiguous whatever the hours happen to be, and
 * the fix is always the same: say what that day actually is. This one can be enforced
 * anywhere, including in the pure content lint.
 *
 * A PLAIN CLOSURE CLAIM ("we are closed on Mondays") is perfectly good English and is only
 * wrong when it disagrees with the hours. That one needs the records, so it is only reported
 * when the caller supplies the days the venue is actually open.
 *
 * Claims about the KITCHEN are left alone by both rules. The kitchen genuinely is closed on
 * Mondays, `opening_hours_week` renders exactly that, and a guard that fought its own block
 * would be turned off within a month.
 */

/** Monday is 1, matching `Date.getUTCDay` and the `business_hours.day_of_week` column. */
const WEEKDAY_NUMBERS: ReadonlyMap<string, number> = new Map([
  ['sunday', 0],
  ['monday', 1],
  ['tuesday', 2],
  ['wednesday', 3],
  ['thursday', 4],
  ['friday', 5],
  ['saturday', 6],
])

const WEEKDAY_PATTERN = /\b(sun|mon|tues|wednes|thurs|fri|satur)day(s)?\b/gi

/** An exception hung off a day. Ambiguous however true it is. */
const EXCEPTION_PATTERN = /\b(except|excepting|apart from|other than|but not|save for)\b/i

/** A plain statement that we are shut. Fine English, checkable against the records. */
const CLOSURE_PATTERN = /\b(closed|shut|not open|no longer open)\b/i

/**
 * Words that make a segment a claim about food rather than about the front door.
 *
 * "The kitchen is closed on Mondays" is true and has to stay sayable, and the hours block
 * says exactly that in its own plain-text output.
 */
const KITCHEN_PATTERN = /\b(kitchen|food|menu|serving|served|lunch|dinner|roast|breakfast|pizza)\b/i

/**
 * Splits copy into the units a reader parses as one claim.
 *
 * Sentence terminators are not enough. "We are open from midday every day except Monday, and
 * the kitchen times are below" is one sentence containing both the fault and the word
 * "kitchen", so splitting on full stops alone would let the kitchen exemption swallow it.
 * Coordinating conjunctions after a comma start a new independent clause, so they split too.
 */
function segments(text: string): string[] {
  return text
    .split(/[.!?;:\n]+|,\s+(?=and\b|but\b|so\b|then\b|though\b|while\b|whereas\b)/i)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/**
 * Weekday names in a segment, ignoring the ones that are part of a specific date.
 *
 * `opening_hours_dates` writes "Fri 25 Dec: Closed", which is a real closure on a real date
 * and must not be reported. A weekday followed by a day number is a date, not a recurring
 * claim about every Friday.
 */
function weekdaysIn(segment: string): string[] {
  const found: string[] = []

  for (const match of segment.matchAll(WEEKDAY_PATTERN)) {
    const after = segment.slice((match.index ?? 0) + match[0].length)
    if (/^\s+\d{1,2}\b/.test(after)) continue
    found.push(match[0])
  }

  return found
}

export type VenueClosureClaimKind = 'exception-phrasing' | 'contradicts-hours'

export interface VenueClosureClaim {
  kind: VenueClosureClaimKind
  /** The weekday as the copy wrote it, so a message can quote the author back to themselves. */
  weekday: string
  /** The clause it appeared in, trimmed, so the author can find it. */
  excerpt: string
  message: string
}

function excerptOf(segment: string): string {
  const flat = segment.replace(/\s+/g, ' ').trim()
  return flat.length > 140 ? `${flat.slice(0, 137)}...` : flat
}

/**
 * Reports copy that could tell a reader the pub is shut when it is open.
 *
 * `openWeekdays` holds the day numbers the venue's front door opens, from `business_hours`.
 * Omit it and only the phrasing rule runs, which is what the pure content lint does; supply
 * it and plain closure claims are checked against the records as well.
 */
export function findVenueClosureClaims(
  text: string,
  openWeekdays?: ReadonlySet<number>,
): VenueClosureClaim[] {
  const claims: VenueClosureClaim[] = []

  for (const segment of segments(text)) {
    if (KITCHEN_PATTERN.test(segment)) continue

    const days = weekdaysIn(segment)
    if (days.length === 0) continue

    if (EXCEPTION_PATTERN.test(segment)) {
      claims.push({
        kind: 'exception-phrasing',
        weekday: days[0],
        excerpt: excerptOf(segment),
        message:
          `"${excerptOf(segment)}" hangs an exception off ${days[0]}, which reads as "we are shut ` +
          `then" whatever the hours are. Say what that day is instead, for example "from midday ` +
          `Tuesday to Sunday and from 4pm on Mondays".`,
      })
      continue
    }

    if (!openWeekdays || !CLOSURE_PATTERN.test(segment)) continue

    for (const day of days) {
      const number = WEEKDAY_NUMBERS.get(day.toLowerCase().replace(/s$/, ''))
      if (number === undefined || !openWeekdays.has(number)) continue

      claims.push({
        kind: 'contradicts-hours',
        weekday: day,
        excerpt: excerptOf(segment),
        message:
          `"${excerptOf(segment)}" says we are shut on ${day}, but the published business hours ` +
          `have the pub open that day. If you mean the kitchen, say so.`,
      })
    }
  }

  return claims
}
