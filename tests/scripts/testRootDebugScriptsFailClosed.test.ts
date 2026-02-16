import fs from 'node:fs'
import path from 'node:path'

type ScriptCase = {
  file: string
  required: string[]
  forbidden: string[]
}

const CASES: ScriptCase[] = [
  {
    file: 'scripts/debug-booking-payment.ts',
    required: ['--booking-ref', 'read-only', 'process.exitCode'],
    forbidden: ['TB-2025-0500', 'process.exit('],
  },
  {
    file: 'scripts/debug-booking-payment-records.ts',
    required: ['--booking-ref', 'read-only', 'process.exitCode'],
    forbidden: ['TB-2025-0500', 'process.exit('],
  },
  {
    file: 'scripts/check-booking-state.ts',
    required: ['--token', 'read-only', 'process.exitCode'],
    forbidden: ['ed551746-5b55-43ad-aaa5-a3b6cb9e6fb9', 'process.exit('],
  },
  {
    file: 'scripts/debug-bookings.ts',
    required: ['--limit', 'read-only', 'process.exitCode'],
    forbidden: ['process.exit('],
  },
  {
    file: 'scripts/debug-business-hours.ts',
    required: ['--day-of-week', 'read-only', 'process.exitCode'],
    forbidden: ['process.exit('],
  },
  {
    file: 'scripts/check_hours_debug.ts',
    required: ['--special-date', '--day-of-week', 'read-only', 'process.exitCode'],
    forbidden: ['2025-12-07', 'process.exit('],
  },
  {
    file: 'scripts/check_hours_debug.js',
    required: ['--special-date', '--day-of-week', 'read-only', 'process.exitCode'],
    forbidden: ['2025-12-07', 'process.exit('],
  },
  {
    file: 'scripts/fetch-events-for-categorization.ts',
    required: ['--limit', '--from-date', 'read-only', 'process.exitCode'],
    forbidden: ['process.exit('],
  },
  {
    file: 'scripts/reproduce_availability.js',
    required: ['--date', 'read-only', 'process.exitCode'],
    forbidden: ['2025-12-07', 'process.exit('],
  },
  {
    file: 'scripts/create-placeholder-icons.js',
    required: ['process.exitCode'],
    forbidden: ['process.exit('],
  },
  {
    file: 'scripts/check-employee-status.ts',
    required: ['read-only', '--confirm', 'process.exitCode'],
    forbidden: ['process.exit('],
  },
  {
    file: 'scripts/check-golden-barrels-projects.ts',
    required: ['--vendor-id', '--limit', 'read-only', 'process.exitCode'],
    forbidden: ['227df11c-9f6b-4a87-b45f-ee341cb509d2', 'process.exit('],
  },
  {
    file: 'scripts/check-golden-barrels-status.ts',
    required: ['--vendor-id', '--vendor-ilike', '--from-date', '--invoice-number', 'read-only', 'process.exitCode'],
    forbidden: ['INV-003VB', 'INV-003VI', '2026-01-01', 'process.exit('],
  },
  {
    file: 'scripts/debug-schema.ts',
    required: ['--limit', 'read-only', 'booking_source', 'process.exitCode'],
    forbidden: ['process.exit('],
  },
  {
    file: 'scripts/debug-outstanding.ts',
    required: ['--limit', 'read-only', 'count_receipt_statuses', 'process.exitCode'],
    forbidden: ['process.exit('],
  },
  {
    file: 'scripts/debug-candidates.ts',
    required: ['--limit', 'read-only', 'maskEmail', 'process.exitCode'],
    forbidden: [".select('*')", 'Email:', 'Parsed Data:', 'process.exit('],
  },
]

describe('root debug scripts fail closed and require explicit inputs', () => {
  for (const entry of CASES) {
    it(entry.file, () => {
      const scriptPath = path.resolve(process.cwd(), entry.file)
      const script = fs.readFileSync(scriptPath, 'utf8')

      for (const required of entry.required) {
        expect(script).toContain(required)
      }

      for (const forbidden of entry.forbidden) {
        expect(script).not.toContain(forbidden)
      }
    })
  }
})
