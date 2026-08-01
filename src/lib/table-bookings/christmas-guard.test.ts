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

/**
 * Anchored on the guard function, not on the file.
 *
 * This used to match the FIRST multi-line RAISE EXCEPTION anywhere in the migration. Adding any
 * other raised exception above `assert_seasonal_booking_type_in_period` therefore silently
 * repointed the test at a different string, and it would have gone on passing while checking
 * something entirely unrelated. It now isolates the function body first, and fails loudly if the
 * shape it depends on has moved.
 */
function guardFunctionBody(): string {
  const sql = readFileSync(MIGRATION, 'utf8')
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.assert_seasonal_booking_type_in_period()')
  if (start === -1) {
    throw new Error('assert_seasonal_booking_type_in_period is no longer in the migration')
  }
  const end = sql.indexOf('$$;', start)
  if (end === -1) throw new Error('Could not find the end of the Christmas guard function body')
  return sql.slice(start, end)
}

function guardMessageFromMigration(): string {
  const body = guardFunctionBody()
  const match = body.match(/RAISE EXCEPTION\s*\n\s*'([^']+)'/)
  if (!match) {
    throw new Error('Could not find the RAISE EXCEPTION inside assert_seasonal_booking_type_in_period')
  }
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

  it('reads the message out of the guard itself, not out of whatever is highest in the file', () => {
    // Proves the anchoring, which is the whole point of the rewrite above. The extracted string
    // must be the one inside the trigger function, and the function body it came from must be the
    // guard rather than any other block that happens to raise.
    const body = guardFunctionBody()
    expect(body).toContain("period_kind = 'christmas'")
    expect(body).toContain(guardMessageFromMigration())

    // And there really is at least one other RAISE EXCEPTION in the file, so "first match in the
    // file" and "match inside the guard" are genuinely different answers.
    const wholeFile = readFileSync(MIGRATION, 'utf8')
    const allRaises = wholeFile.match(/RAISE EXCEPTION/g) ?? []
    expect(allRaises.length).toBeGreaterThan(1)
  })
})
