import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const bookingRoute = readFileSync(resolve(process.cwd(), 'src/app/api/recruitment/booking/[token]/route.ts'), 'utf8')
const cancelRoute = readFileSync(resolve(process.cwd(), 'src/app/api/recruitment/booking/[token]/cancel/route.ts'), 'utf8')
const rescheduleRoute = readFileSync(resolve(process.cwd(), 'src/app/api/recruitment/booking/[token]/reschedule/route.ts'), 'utf8')

describe('A-089 recruitment public-route security wiring', () => {
  it('guards public booking preview, claim, cancel, and reschedule routes', () => {
    expect(bookingRoute.match(/guardPublicRecruitmentRequest\(/g)?.length).toBe(2)
    expect(bookingRoute).toContain("scope: 'recruitment-booking-preview'")
    expect(bookingRoute).toContain("scope: 'recruitment-booking-claim'")
    expect(bookingRoute).toContain('requireTurnstile: true')
    expect(cancelRoute).toContain("scope: 'recruitment-booking-cancel'")
    expect(cancelRoute).toContain('requireTurnstile: true')
    expect(rescheduleRoute).toContain("scope: 'recruitment-booking-reschedule'")
    expect(rescheduleRoute).toContain('requireTurnstile: true')
  })

  // "Retention cleanup skips candidates already anonymised" used to be checked
  // here by looking for a line of source. The job moved to
  // src/services/recruitment-retention.ts and the rule is now proved by running
  // it: see "running it again" and "people the old job already cleared" in
  // tests/services/recruitmentRetention.test.ts.
})
