import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BK-087 (customer bookings review, 24 October 2026): every check-in used to queue a review text
 * for 10:00 the next morning, on top of the 09:00 ask from the engagement cron, with no first-visit
 * or review-once check. The cron's ask is now the one ask per night, so check-in queues nothing.
 */
describe('event check-in sends no thank-you text', () => {
  it('queues no SMS job and builds no review link', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/actions/event-check-in.ts'), 'utf8')
    expect(source).not.toContain('event_check_in_thank_you')
    expect(source).not.toContain("'send_sms'")
    expect(source).not.toContain('getGoogleReviewLink')
  })
})
