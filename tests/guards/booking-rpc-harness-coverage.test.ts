import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Every booking function the app calls must be tested, in CI, in the version production runs.
 *
 * The customer bookings review of 24 October 2026 (BK-126) found the Postgres harnesses that
 * run on every change loading older versions of the event booking functions: each harness pins
 * the migration it was written for, and when a later migration replaced the functions nobody
 * moved the harness. The live seat-selling bodies were tested only by a script run by hand.
 *
 * So this guard reads every `.rpc('<name>'` call in src, keeps the booking ones, finds the
 * newest migration that creates each function, and fails unless a CI harness
 * (scripts/testing/*-postgres.py, run by `npm run test:pg`) loads that migration, directly or
 * through a SQL suite it runs.
 *
 * WHEN THIS FAILS for a migration you have just written: add a harness for it (model it on
 * scripts/testing/event-communal-payment-confirm-postgres.py) or load it in the harness that
 * already covers the function. Do not add it to KNOWN_UNCOVERED.
 */
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const MIGRATIONS = join(ROOT, 'supabase/migrations')
const HARNESSES = join(ROOT, 'scripts/testing')

/** Booking, seat, waitlist and booking-payment functions. */
const BOOKING_RPC = /(event_booking|table_booking|event_table_reservation|waitlist|event_(paypal|manual)_payment|capacity_snapshot|booking_seats)/

/**
 * Booking functions whose newest migration no CI harness loads, as found on 26 October 2026.
 * Each names that migration: when a new migration replaces the function the entry no longer
 * matches and the guard fails, so the new version gets a harness. This list may only shrink;
 * when one gains a harness the guard fails until its line is deleted.
 */
const KNOWN_UNCOVERED: Record<string, { migration: string; note: string }> = {
  cancel_event_booking_v05: { migration: '20260421000002_event_table_invariants.sql', note: 'no harness' },
  create_event_waitlist_entry_v05: { migration: '20260420000022_event_modes_table_reservations_and_private_buffers.sql', note: 'no harness' },
  update_event_booking_seats_v05: {
    migration: '20260708000000_guard_linked_event_table_capacity.sql',
    note: 'the live body (md5 checked against production 26 October 2026) is in tests/database/event-physical-capacity/setup.sql, which event-physical-capacity-postgres.py loads, but the migration file itself is not loaded',
  },
  create_table_booking_staff_v06: { migration: '20260803000200_seasonal_deposit_on_create.sql', note: 'table bookings: tests/sql/run.sh covers the allocator in Docker, not in CI' },
  get_table_booking_settings: { migration: '20260803000100_seasonal_booking_periods.sql', note: 'no harness' },
  set_table_booking_settings: { migration: '20260801000500_table_booking_settings_rpc.sql', note: 'no harness' },
  move_table_booking_assignments_v05: { migration: '20260728000000_highchair_outside.sql', note: 'no harness' },
  move_table_booking_time_v06: { migration: '20260901120000_move_table_booking_time_v06.sql', note: 'no harness' },
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      sourceFiles(path, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

function calledBookingRpcs(): Map<string, string[]> {
  const calls = new Map<string, string[]>()
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\.rpc\(\s*['"`]([a-z0-9_]+)['"`]/g)) {
      const name = match[1]
      if (!BOOKING_RPC.test(name)) continue
      const files = calls.get(name) ?? []
      files.push(relative(ROOT, file))
      calls.set(name, files)
    }
  }
  return calls
}

function newestDefiningMigration(name: string, migrations: Array<{ file: string; text: string }>): string | null {
  const creates = new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?"?${name}"?\\s*\\(`, 'i')
  let newest: string | null = null
  for (const migration of migrations) {
    if (creates.test(migration.text)) newest = migration.file
  }
  return newest
}

/** Every harness, plus each SQL suite a harness names (they load migrations with \ir). */
function harnessCorpus(): string {
  const harnesses = readdirSync(HARNESSES)
    .filter((name) => name.endsWith('-postgres.py'))
    .map((name) => readFileSync(join(HARNESSES, name), 'utf8'))
  let corpus = harnesses.join('\n')
  for (const match of corpus.matchAll(/tests\/[\w/.-]+\.sql/g)) {
    try {
      corpus += '\n' + readFileSync(join(ROOT, match[0]), 'utf8')
    } catch {
      // A path in a comment that no longer exists is not coverage.
    }
  }
  return corpus
}

describe('booking functions are tested in CI in the version production runs', () => {
  const migrations = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(MIGRATIONS, file), 'utf8') }))
  const calls = calledBookingRpcs()
  const corpus = harnessCorpus()

  it('finds the booking functions the app calls', () => {
    // A sanity floor: the reader still sees the calls it was written for.
    expect(calls.has('create_event_booking_v08')).toBe(true)
    expect(calls.has('confirm_event_paypal_payment_v01')).toBe(true)
    expect(calls.size).toBeGreaterThanOrEqual(20)
  })

  it('loads the newest migration of every booking function in a CI harness', () => {
    const problems: string[] = []
    for (const [name, files] of [...calls].sort(([a], [b]) => a.localeCompare(b))) {
      const newest = newestDefiningMigration(name, migrations)
      if (!newest) {
        problems.push(`${name} (called in ${files[0]}) is created by no migration in supabase/migrations`)
        continue
      }
      const covered = corpus.includes(newest)
      const known = KNOWN_UNCOVERED[name]
      if (covered && known) {
        problems.push(`${name} is now covered by a harness: delete its KNOWN_UNCOVERED line`)
      } else if (!covered && !known) {
        problems.push(`${name} (called in ${files[0]}): no harness in scripts/testing loads its newest migration ${newest}`)
      } else if (!covered && known && known.migration !== newest) {
        problems.push(`${name} was redefined by ${newest}, which no harness loads (KNOWN_UNCOVERED lists ${known.migration})`)
      }
    }
    expect(problems).toEqual([])
  })

  it('lists no function the app no longer calls', () => {
    const stale = Object.keys(KNOWN_UNCOVERED).filter((name) => !calls.has(name))
    expect(stale).toEqual([])
  })
})
