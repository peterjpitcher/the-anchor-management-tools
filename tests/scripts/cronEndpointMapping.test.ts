import fs from 'node:fs'
import path from 'node:path'

// vercel.json is the only cron scheduler. The GitHub Actions copies were removed on
// 10 November 2026 because they duplicated it and used up the Actions allowance.
const SCHEDULE_FILES = ['vercel.json']

const LEGACY_BOOKING_ENDPOINTS = [
  '/api/cron/table-booking-reminders',
  '/api/cron/table-booking-monitoring',
]

const REPPOINTED_BOOKING_ENDPOINTS = [
  '/api/cron/event-booking-holds',
]

const RETIRED_BOOKING_ENDPOINTS = [
  '/api/cron/sunday-preorder',
  '/api/cron/sunday-lunch-prep',
]

describe('booking cron schedule endpoint mapping', () => {
  it('uses existing cron routes and does not reference removed booking cron paths', () => {
    for (const relativeSchedulePath of SCHEDULE_FILES) {
      const workflowPath = path.resolve(process.cwd(), relativeSchedulePath)
      const workflowContent = fs.readFileSync(workflowPath, 'utf8')

      for (const legacyEndpoint of LEGACY_BOOKING_ENDPOINTS) {
        expect(workflowContent).not.toContain(legacyEndpoint)
      }

      for (const retiredEndpoint of RETIRED_BOOKING_ENDPOINTS) {
        expect(workflowContent).not.toContain(retiredEndpoint)
      }
    }

    for (const endpoint of REPPOINTED_BOOKING_ENDPOINTS) {
      const routePath = path.resolve(process.cwd(), `src/app${endpoint}/route.ts`)
      expect(fs.existsSync(routePath)).toBe(true)
    }
  })
})
