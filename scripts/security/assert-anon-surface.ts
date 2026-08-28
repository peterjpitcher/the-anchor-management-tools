#!/usr/bin/env tsx

/**
 * Read-only assertion over what the public anon key can reach.
 *
 *   npx tsx scripts/security/assert-anon-surface.ts
 *
 * Mutates nothing. Exits 1 on any regression, so it can gate a deploy. Run it
 * after any migration that creates a table, a view or a SECURITY DEFINER
 * routine, and after anything that touches RLS or grants.
 *
 * Why this exists. Three separate incidents in August 2026 shared one root:
 * `pg_default_acl` hands anon access to every new object in `public`, and
 * nothing failed loudly when it did.
 *
 *   - 27 Aug: `timeclock_sessions` was readable with the browser key, exposing
 *     `rate_override` and `manager_note` for every clocked-in employee.
 *   - 27 Aug: three views ran without `security_invoker`, so they executed as
 *     their owner and defeated RLS on the tables beneath.
 *   - 28 Aug: `leave_reminder_log` inherited anon SELECT within minutes of
 *     being created.
 *
 * Migration 20260828120356 removed the defaults and installed an event
 * trigger. This script is the thing that notices if that ever stops working.
 *
 * The checks live in the database, in `public.v_anon_surface_report`, so the
 * SQL stays next to the catalogues it inspects and this file stays a thin
 * runner. Both directions are asserted: nothing newly exposed, and the twelve
 * tables plus three RPCs the public website needs are still reachable.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'assert-anon-surface'

/** Said in plain terms, because whoever sees this failing may not have the context. */
const EXPLANATIONS: Record<string, string> = {
  anon_executable_security_definer_functions:
    'A SECURITY DEFINER routine is callable with the public browser key. These run with the owner rights and ignore row security, so this is a direct data exposure. Add REVOKE EXECUTE ... FROM PUBLIC, anon to its migration.',
  tables_granting_anon_writes:
    'A table grants anon INSERT, UPDATE, DELETE or TRUNCATE. TRUNCATE is not filtered by row security at all.',
  anon_readable_tables_without_rls:
    'A table is readable with the public key and has row security switched off, so every row is exposed.',
  anon_readable_views_without_security_invoker:
    'A view is readable with the public key and runs as its owner rather than the caller, which defeats row security on the tables underneath.',
  default_privileges_guard_enabled:
    'The event trigger from migration 20260828120356 is missing or disabled. New SECURITY DEFINER routines will silently inherit PUBLIC EXECUTE again.',
  anon_in_default_privileges_for_new_tables:
    'The default privileges grant anon on new tables again, so every table created from now on inherits access nobody asked for.',
  website_tables_still_anon_readable:
    'The public website reads these twelve tables with the anon key and one has lost access, so pages will be blank. Add an explicit GRANT SELECT ... TO anon in the migration that created or recreated it.',
  website_rpcs_still_anon_callable:
    'The public website calls these three functions with the anon key and one has lost access. A CREATE OR REPLACE must re-issue GRANT EXECUTE ... TO anon in the same migration.',
  public_objects_not_owned_by_postgres:
    'Something in public is owned by another role. The default-privileges fix only governs objects postgres creates, and supabase_admin still grants anon full table privileges by default.',
}

interface ReportRow {
  check_name: string
  actual: number
  expected: number
}

async function main(): Promise<void> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('v_anon_surface_report')
    .select('check_name, actual, expected')
    .order('check_name')

  if (error) {
    console.error(
      `[${SCRIPT_NAME}] could not read public.v_anon_surface_report: ${error.message}\n` +
        'If the view is missing, migration 20260828120614_anon_surface_report_view has not been applied.',
    )
    process.exitCode = 1
    return
  }

  const rows = (data ?? []) as ReportRow[]
  if (rows.length === 0) {
    console.error(`[${SCRIPT_NAME}] the report returned no rows, which should never happen.`)
    process.exitCode = 1
    return
  }

  const failures = rows.filter(r => Number(r.actual) !== Number(r.expected))

  for (const row of rows.filter(r => Number(r.actual) === Number(r.expected))) {
    console.warn(`  PASS  ${row.check_name} (${row.actual})`)
  }

  if (failures.length > 0) {
    console.error(`\n[${SCRIPT_NAME}] ${failures.length} of ${rows.length} checks FAILED\n`)
    for (const row of failures) {
      console.error(`  FAIL  ${row.check_name}`)
      console.error(`        expected ${row.expected}, found ${row.actual}`)
      console.error(`        ${EXPLANATIONS[row.check_name] ?? 'No explanation recorded for this check.'}\n`)
    }
    process.exitCode = 1
    return
  }

  console.warn(`\n[${SCRIPT_NAME}] all ${rows.length} checks passed.`)
}

main().catch(error => {
  console.error(`[${SCRIPT_NAME}] fatal:`, error)
  process.exitCode = 1
})
