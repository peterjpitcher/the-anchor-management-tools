import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BK-220: the dashboard ran two queries on every uncached build to total private-hire 'revenue
 * today' and pipeline value from private_bookings.total_amount, which is empty on every booking,
 * and showed neither: the money cards came off the dashboard on purpose in March 2026. Both are
 * gone, and must not come back reading that column.
 */
const SOURCE = readFileSync(join(process.cwd(), 'src/app/(authenticated)/dashboard/dashboard-data.ts'), 'utf8')

describe('dashboard private-hire money', () => {
  it('works out no private-hire revenue or pipeline value', () => {
    expect(SOURCE).not.toMatch(/revenueToday|bookingPipelineValue|BookingPipelineValue/)
  })

  it('never reads private_bookings.total_amount', () => {
    const privateBookingReads = [...SOURCE.matchAll(/\.from\('private_bookings'\)\s*\.select\(([^)]*)\)/g)].map((match) => match[1])
    expect(privateBookingReads.filter((columns) => columns.includes('total_amount'))).toEqual([])
  })
})
