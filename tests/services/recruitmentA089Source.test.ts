import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const bookingRoute = readFileSync(resolve(process.cwd(), 'src/app/api/recruitment/booking/[token]/route.ts'), 'utf8')
const cancelRoute = readFileSync(resolve(process.cwd(), 'src/app/api/recruitment/booking/[token]/cancel/route.ts'), 'utf8')
const rescheduleRoute = readFileSync(resolve(process.cwd(), 'src/app/api/recruitment/booking/[token]/reschedule/route.ts'), 'utf8')
const recruitmentService = readFileSync(resolve(process.cwd(), 'src/services/recruitment.ts'), 'utf8')

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

  it('retention cleanup skips candidates already anonymised', () => {
    expect(recruitmentService).toContain('if (candidate.anonymised_at) continue')
  })
})
