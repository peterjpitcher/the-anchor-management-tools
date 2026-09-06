import { describe, expect, it } from 'vitest'

/**
 * Guards the two-timezone test harness itself.
 *
 * The suite defaults to Europe/London (the business timezone) but must genuinely switch to
 * whatever timezone the run asked for, so `npm run test:utc` really exercises UTC, the timezone
 * the Vercel serverless runtime runs in. `vitest.config.ts` used to hardcode Europe/London,
 * which silently swallowed a `TZ=UTC` prefix: the run claimed UTC and still executed in London.
 *
 * `process.env.TZ` alone cannot catch that regression, because Vitest overwrites it inside the
 * worker with whatever the config says, so the test would only ever read back the config's own
 * answer. The npm scripts therefore also export HARNESS_EXPECTED_TZ, which the config does not
 * touch. If the config ever pins the timezone again, the two disagree and this file fails.
 */

const EXPECTED_TIMEZONE = process.env.HARNESS_EXPECTED_TZ ?? process.env.TZ ?? 'Europe/London'

// 1 July 2026 is inside British Summer Time, so London is UTC+1 and the two zones genuinely
// disagree. A winter instant would render identically in both and prove nothing.
const SUMMER_INSTANT = new Date('2026-07-01T12:00:00Z')

function formatHourIn(timeZone: string, instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant)
}

function formatHourInHostZone(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant)
}

describe('test harness timezone', () => {
  it('runs in the timezone the run asked for', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EXPECTED_TIMEZONE)
  })

  it('confirms London and UTC really differ for the chosen instant', () => {
    // If these ever match, the fixture instant has drifted out of British Summer Time and the
    // regression checks below would pass for the wrong reason.
    expect(formatHourIn('Europe/London', SUMMER_INSTANT)).toBe('13:00')
    expect(formatHourIn('UTC', SUMMER_INSTANT)).toBe('12:00')
  })

  it('formats a summer instant in the requested timezone, not a hardcoded one', () => {
    expect(formatHourInHostZone(SUMMER_INSTANT)).toBe(
      formatHourIn(EXPECTED_TIMEZONE, SUMMER_INSTANT)
    )
  })

  it('reports UTC when the run asked for UTC', () => {
    if (EXPECTED_TIMEZONE !== 'UTC') {
      // Nothing to prove on a London run; the London case below covers that.
      return
    }

    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC')
    expect(formatHourInHostZone(SUMMER_INSTANT)).toBe('12:00')
    expect(SUMMER_INSTANT.getHours()).toBe(12)
  })

  it('reports Europe/London when the run asked for London', () => {
    if (EXPECTED_TIMEZONE !== 'Europe/London') {
      return
    }

    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/London')
    expect(formatHourInHostZone(SUMMER_INSTANT)).toBe('13:00')
    expect(SUMMER_INSTANT.getHours()).toBe(13)
  })
})
