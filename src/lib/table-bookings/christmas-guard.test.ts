import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractChristmasRuleErrorMessage } from './christmas'

/**
 * The seam between the database guard and what a member of staff actually reads.
 *
 * The seasonal-periods migration adds a trigger that refuses a Christmas booking unless a live
 * Christmas period covers the date. Both create paths, /api/foh/bookings and /api/table-bookings,
 * pass a database error straight through to the user ONLY when
 * `extractChristmasRuleErrorMessage` recognises it, which it does by the literal prefix
 * "Christmas bookings ". Anything else becomes a logged generic failure.
 *
 * So the wording in the SQL is load-bearing. Reword it to "A Christmas booking cannot..." and
 * staff stop seeing "activate the period in Settings" and start seeing an opaque error instead,
 * with nothing failing anywhere to tell you. This test reads the message out of the migration
 * itself so the two cannot drift apart quietly.
 */

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/20260803000100_seasonal_booking_periods.sql',
)

function guardMessageFromMigration(): string {
  const sql = readFileSync(MIGRATION, 'utf8')
  const match = sql.match(/RAISE EXCEPTION\s*\n\s*'([^']+)'/)
  if (!match) throw new Error('Could not find the Christmas guard RAISE EXCEPTION in the migration')
  return match[1]
}

describe('the Christmas guard message reaches staff intact', () => {
  it('the migration still raises a message the passthrough recognises', () => {
    const raw = guardMessageFromMigration()
    // Postgres substitutes %; the prefix check runs on the formatted string.
    const formatted = raw.replace('%', '05 Dec 2026')

    expect(extractChristmasRuleErrorMessage({ message: formatted })).toBe(formatted)
  })

  it('the message tells the reader what to do, not just that it failed', () => {
    const raw = guardMessageFromMigration()
    expect(raw).toContain('Settings')
    expect(raw).toContain('activate')
  })

  it('still ignores unrelated database errors', () => {
    expect(extractChristmasRuleErrorMessage({ message: 'duplicate key value violates unique constraint' }))
      .toBeNull()
    expect(extractChristmasRuleErrorMessage(null)).toBeNull()
    expect(extractChristmasRuleErrorMessage({ message: '' })).toBeNull()
  })
})
