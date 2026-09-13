import { describe, expect, it } from 'vitest'

/**
 * The two-zone gate, guarded.
 *
 * `npm test` runs the suite in Europe/London (the business zone) and `npm run test:utc` runs the
 * same suite in UTC (what the serverless runtime uses). That gate was previously a false green:
 * vitest.config.ts hardcoded `env: { TZ: 'Europe/London' }`, which overrode any TZ given on the
 * command line, so both runs were Europe/London and no UTC-only date bug could ever be caught.
 *
 * These assertions read the expected zone from TEST_TZ, the same variable vitest.config.ts uses
 * to set the runtime zone, so they fail loudly if the requested zone stops taking effect.
 */
const expectedTimezone = process.env.TEST_TZ ?? 'Europe/London'

describe('test timezone gate', () => {
  it('runs in the requested timezone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(expectedTimezone)
  })

  it('agrees with the TZ the runtime was handed', () => {
    expect(process.env.TZ).toBe(expectedTimezone)
  })

  it('offsets a British Summer Time instant the way the requested zone should', () => {
    // Midsummer noon UTC is 13:00 in London (BST, so UTC+1) and 12:00 in UTC. Reading the local
    // hour straight off a Date is exactly the mistake this gate exists to catch, so that is the
    // check: the ambient zone must agree with a formatter pinned to the zone we asked for.
    const midsummerNoonUtc = new Date('2026-07-04T12:00:00.000Z')
    const expectedLocalHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: expectedTimezone,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(midsummerNoonUtc)
    )

    expect(midsummerNoonUtc.getHours()).toBe(expectedLocalHour)
  })
})
