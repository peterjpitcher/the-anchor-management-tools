import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Migration 20261027001434 (BK-008) closed the booking and payment tables to signed-in
 * accounts: only service_role reaches them, except table assignments, which staff with
 * table_bookings view may read. Before it, one policy per table let any login read and
 * change every row (USING auth.uid() IS NOT NULL), so the app's permission checks and
 * audit log were skipped from a browser console.
 *
 * This guard fails if a later migration reopens one of them with an any-login policy or a
 * write grant to anon or authenticated. Scope a new staff read with user_has_permission
 * instead, the way booking_table_assignments_staff_select does.
 */

const ROOT = process.cwd()
const MIGRATIONS = join(ROOT, 'supabase/migrations')
const LOCKED_FROM = '20261027001434'
const TABLES = [
  'payments',
  'guest_tokens',
  'booking_holds',
  'booking_table_assignments',
  'waitlist_entries',
  'waitlist_offers',
  'charge_requests',
  'short_links',
]
const TABLE = `(?:public\\.)?"?(?:${TABLES.join('|')})"?`

function laterMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql') && name.slice(0, 14) >= LOCKED_FROM)
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }))
}

function statements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
}

describe('booking and payment tables stay closed to signed-in accounts', () => {
  const migrations = laterMigrations()

  it('reads the migration that closed them', () => {
    expect(migrations.map((migration) => migration.name)).toContain(
      '20261027001434_staff_database_access.sql',
    )
  })

  it('adds no policy that lets any login through', () => {
    const anyLogin = new RegExp(
      `^CREATE POLICY .* ON ${TABLE} .*(?:USING|WITH CHECK) \\(+\\s*(?:true|auth\\.uid\\(\\) IS NOT NULL)\\s*\\)+`,
      'i',
    )
    const offenders = migrations.flatMap(({ name, sql }) =>
      statements(sql).filter((statement) => anyLogin.test(statement)).map((statement) => `${name}: ${statement}`),
    )
    expect(offenders).toEqual([])
  })

  it('grants no write on them to anon or authenticated', () => {
    const writeGrant = new RegExp(
      `^GRANT (?:ALL|[A-Z, ]*\\b(?:INSERT|UPDATE|DELETE)\\b[A-Z, ]*) ON (?:TABLE )?(?:${TABLE}\\s*,\\s*)*${TABLE}.* TO .*\\b(?:anon|authenticated)\\b`,
      'i',
    )
    const offenders = migrations.flatMap(({ name, sql }) =>
      statements(sql).filter((statement) => writeGrant.test(statement)).map((statement) => `${name}: ${statement}`),
    )
    expect(offenders).toEqual([])
  })
})
