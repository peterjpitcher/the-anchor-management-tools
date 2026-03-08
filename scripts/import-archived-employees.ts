#!/usr/bin/env tsx
/**
 * import-archived-employees.ts
 *
 * Imports archived/former employees from the WIW "Archived Users" CSV export
 * into the employees table.
 *
 * Rules:
 *  - Matches against existing employees by email (case-insensitive), then full name.
 *  - Deduplicates within the CSV itself:
 *      • Same email → keep entry with most recent Archived Date
 *      • Same normalised name → merge email from whichever entry has one
 *      • Known alias pairs (see KNOWN_ALIASES) are merged explicitly
 *  - Employees already in the system are SKIPPED (no overwrite).
 *  - New employees are created with status = 'Former'.
 *  - Positions column is parsed into a human job_title.
 *  - Archived Date is stored as employment_end_date.
 *  - employment_start_date is left null (column is nullable per migration 20260227000001).
 *  - Phone numbers in the CSV are in floating-point scientific notation and
 *    cannot be reliably reconstructed — they are NOT imported.
 *  - No emails are sent — this is a silent historical import.
 *
 * Usage:
 *   npx tsx scripts/import-archived-employees.ts            # dry run (safe)
 *   npx tsx scripts/import-archived-employees.ts --confirm  # live run
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import Papa from 'papaparse'
import { parse as parseDate, format as formatDate } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCRIPT_NAME = 'import-archived-employees'
const CSV_PATH = path.resolve(
  process.cwd(),
  'temp/Archived Users as of Mar 6, 2026.csv',
)

/**
 * Pairs of CSV names that refer to the same person.
 * Key   = the name to DISCARD (will be merged into value).
 * Value = the canonical name to KEEP.
 * Normalise to lowercase for comparison.
 */
const KNOWN_ALIASES: Record<string, string> = {
  'leanne mitcell':                 'leanne mitchell',   // typo in WIW
  'stephen george dunstan morris':  'stephen morris',    // full legal name vs common name
  'suk c':                          'sukhvinder kaur conkaria', // abbreviated entry
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsvRow {
  'Archived Date': string
  'Archived Time': string
  'First Name': string
  'Last Name': string
  Email: string
  'Phone Number': string
  'Employee ID': string
  Schedules: string
  Positions: string
  'Base Hourly Rate': string
  'Max Hours': string
  Notes: string
  'WIW User ID (DO NOT MODIFY)': string
}

interface NormalisedEntry {
  firstName: string
  lastName: string
  email: string | null
  archivedDate: string  // YYYY-MM-DD
  positions: string
  /** The raw CSV name key(s) this entry represents */
  csvNames: string[]
}

interface ExistingEmployee {
  employee_id: string
  first_name: string
  last_name: string
  email_address: string | null
  status: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "Mar 06, 2026" → "2026-03-06" */
function parseArchivedDate(raw: string): string {
  const cleaned = raw.trim().replace(/"/g, '')
  const d = parseDate(cleaned, 'MMM dd, yyyy', new Date())
  return formatDate(d, 'yyyy-MM-dd')
}

/**
 * Convert Positions column to a clean job title.
 * Priority order: Manager > Chef > Cleaning > Sunday Runner > Runner > Bar Staff > Not Specified
 */
function positionsToJobTitle(positions: string): string {
  const raw = positions.trim()
  if (!raw || raw.toLowerCase() === 'none') return 'Not Specified'

  const parts = raw.split(',').map(p => p.trim().toLowerCase())

  if (parts.some(p => p === 'manager'))       return 'Manager'
  if (parts.some(p => p === 'chef'))           return 'Chef'
  if (parts.some(p => p === 'cleaning'))       return 'Cleaning'
  if (parts.some(p => p === 'sunday runner'))  return 'Sunday Runner'
  if (parts.some(p => p === 'runner'))         return 'Runner'
  // Everything else bar-related
  return 'Bar Staff'
}

function normaliseName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.toLowerCase().trim()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = !args.includes('--confirm')

  console.log('')
  console.log(`╔══════════════════════════════════════════════════╗`)
  console.log(`║  ${SCRIPT_NAME}`)
  console.log(`║  Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : '⚠  LIVE — changes will be written to the DB'}`)
  console.log(`╚══════════════════════════════════════════════════╝`)
  console.log('')

  const admin = createAdminClient()

  // -------------------------------------------------------------------------
  // 1. Read and parse CSV
  // -------------------------------------------------------------------------
  console.log(`[1/5] Reading CSV…`)
  const csvContent = await fs.readFile(CSV_PATH, 'utf-8')
  const { data: rows, errors: parseErrors } = Papa.parse<CsvRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
  })
  if (parseErrors.length) {
    console.warn(`      CSV parse warnings:`, parseErrors)
  }
  console.log(`      ${rows.length} raw rows loaded`)

  // -------------------------------------------------------------------------
  // 2. Deduplicate within CSV
  //    Strategy:
  //    a) Resolve KNOWN_ALIASES (merge by name)
  //    b) Group by email (keep most recent archived date)
  //    c) Group remaining no-email entries by normalised name
  // -------------------------------------------------------------------------
  console.log(`[2/5] Deduplicating CSV entries…`)

  // Intermediate map: normalised full name → best entry
  const byName = new Map<string, NormalisedEntry>()

  for (const row of rows) {
    const firstName = row['First Name']?.trim() ?? ''
    const lastName  = row['Last Name']?.trim() ?? ''
    const email     = row.Email?.trim().toLowerCase() || null
    const positions = row.Positions?.trim() ?? ''
    const archivedDate = parseArchivedDate(row['Archived Date'] ?? '')
    const csvName   = normaliseName(firstName, lastName)

    // Resolve aliases — map to canonical name
    const canonicalName = KNOWN_ALIASES[csvName] ?? csvName

    // Is this row the alias (discard) side or the canonical side?
    const isAlias = csvName !== canonicalName

    if (byName.has(canonicalName)) {
      const existing = byName.get(canonicalName)!
      // Prefer most recent archive date, but if this row is an alias (the
      // discarded/typo entry), do NOT overwrite the name — keep the canonical name.
      if (archivedDate > existing.archivedDate) {
        existing.archivedDate = archivedDate
        if (!isAlias) {
          existing.firstName = firstName
          existing.lastName  = lastName
          existing.positions = positions
        }
      }
      // Always pick up email if we don't have one yet
      if (!existing.email && email) existing.email = email
      if (!existing.csvNames.includes(csvName)) existing.csvNames.push(csvName)
    } else {
      byName.set(canonicalName, {
        firstName,
        lastName,
        email,
        archivedDate,
        positions,
        csvNames: [csvName],
      })
    }
  }

  // Post-process: if an entry was seeded by an alias (typo/discard) row that
  // happened to appear first in the CSV, its name is wrong. Fix it using the
  // canonical name stored as the map key.
  for (const [canonicalKey, entry] of byName.entries()) {
    const entryNorm = normaliseName(entry.firstName, entry.lastName)
    if (KNOWN_ALIASES[entryNorm] === canonicalKey) {
      const parts = canonicalKey.split(' ')
      entry.firstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
      entry.lastName  = parts.slice(1)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ')
    }
  }

  // Secondary dedup: group by email (catches same person with different names across entries)
  const byEmail = new Map<string, NormalisedEntry>()
  const noEmailEntries: NormalisedEntry[] = []

  for (const entry of byName.values()) {
    if (!entry.email) {
      noEmailEntries.push(entry)
      continue
    }
    if (byEmail.has(entry.email)) {
      const existing = byEmail.get(entry.email)!
      if (entry.archivedDate > existing.archivedDate) {
        // Newer entry wins — keep email
        byEmail.set(entry.email, { ...entry, email: entry.email })
      }
    } else {
      byEmail.set(entry.email, entry)
    }
  }

  const uniqueEntries: NormalisedEntry[] = [
    ...byEmail.values(),
    ...noEmailEntries,
  ]

  console.log(`      ${rows.length} raw rows → ${uniqueEntries.length} unique people after dedup`)
  for (const entry of uniqueEntries) {
    if (entry.csvNames.length > 1) {
      console.log(`      ↳ Merged: ${entry.csvNames.join(' + ')} → "${entry.firstName} ${entry.lastName}" (${entry.email ?? 'no email'})`)
    }
  }

  // -------------------------------------------------------------------------
  // 3. Load existing employees
  // -------------------------------------------------------------------------
  console.log(`\n[3/5] Loading existing employees from DB…`)
  const { data: existing, error: empError } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, email_address, status')

  if (empError) throw new Error(`Failed to fetch employees: ${empError.message}`)

  const dbByEmail = new Map<string, ExistingEmployee>()
  const dbByName  = new Map<string, ExistingEmployee>()

  for (const emp of (existing ?? []) as ExistingEmployee[]) {
    if (emp.email_address) {
      dbByEmail.set(emp.email_address.toLowerCase().trim(), emp)
    }
    const key = normaliseName(emp.first_name, emp.last_name)
    dbByName.set(key, emp)
  }
  console.log(`      ${existing?.length ?? 0} employees already in system`)

  // -------------------------------------------------------------------------
  // 4. Match and classify
  // -------------------------------------------------------------------------
  console.log(`\n[4/5] Matching CSV entries to existing records…`)

  const toCreate: NormalisedEntry[] = []

  for (const entry of uniqueEntries) {
    // Try email match
    let found = entry.email ? dbByEmail.get(entry.email) : undefined

    // Fall back to name match
    if (!found) {
      const nameKey = normaliseName(entry.firstName, entry.lastName)
      found = dbByName.get(nameKey)
    }

    if (found) {
      console.log(
        `      ✓ EXISTS   "${entry.firstName} ${entry.lastName}" → ${found.employee_id} [${found.status}] — skipping`,
      )
    } else {
      toCreate.push(entry)
      console.log(
        `      + NEW      "${entry.firstName} ${entry.lastName}" (${entry.email ?? 'no email'}) ` +
        `archived ${entry.archivedDate} → will create as Former`,
      )
    }
  }

  // -------------------------------------------------------------------------
  // 5. Create missing employees
  // -------------------------------------------------------------------------
  console.log(`\n[5/5] Creating ${toCreate.length} new Former employee(s)…`)

  let created = 0
  let skipped = 0
  let errors  = 0

  for (const entry of toCreate) {
    const jobTitle = positionsToJobTitle(entry.positions)

    // email_address is NOT NULL + UNIQUE in the DB — skip if missing
    if (!entry.email) {
      console.warn(
        `  ⚠ SKIP   "${entry.firstName} ${entry.lastName}" — no email address; add manually if needed`,
      )
      skipped++
      continue
    }

    if (isDryRun) {
      console.log(
        `  DRY RUN  Would create: "${entry.firstName} ${entry.lastName}"` +
        ` email=${entry.email} job="${jobTitle}" end=${entry.archivedDate}`,
      )
      created++
      continue
    }

    const { data: newEmp, error: createErr } = await admin
      .from('employees')
      .insert({
        first_name:           entry.firstName,
        last_name:            entry.lastName,
        email_address:        entry.email,
        status:               'Former',
        job_title:            jobTitle,
        employment_start_date: null,   // not known from this data source
        employment_end_date:  entry.archivedDate,
      })
      .select('employee_id')
      .single()

    if (createErr) {
      console.error(
        `  ✗ ERROR  "${entry.firstName} ${entry.lastName}": ${createErr.message}`,
      )
      errors++
    } else {
      console.log(
        `  ✓ CREATED "${entry.firstName} ${entry.lastName}" → ${newEmp.employee_id}` +
        ` job="${jobTitle}" end=${entry.archivedDate}`,
      )
      created++
    }

    // Brief pause to avoid rate limits on large imports
    await new Promise(r => setTimeout(r, 50))
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('')
  console.log(`╔══════════════════════════════════════════════════╗`)
  console.log(`║  Summary`)
  console.log(`║`)
  console.log(`║  Total unique people in CSV:  ${String(uniqueEntries.length).padStart(3)}`)
  console.log(`║  Already in system (skipped): ${String(uniqueEntries.length - toCreate.length).padStart(3)}`)
  console.log(`║  ${isDryRun ? 'Would create (dry run):' : 'Created:              '}       ${String(created).padStart(3)}`)
  console.log(`║  Skipped (no email, manual needed): ${String(skipped).padStart(3)}`)
  console.log(`║  Errors:                      ${String(errors).padStart(3)}`)
  console.log(`║`)
  if (isDryRun) {
    console.log(`║  DRY RUN complete — no changes written.`)
    console.log(`║  Re-run with --confirm to apply.`)
  } else {
    console.log(`║  LIVE RUN complete.`)
  }
  console.log(`╚══════════════════════════════════════════════════╝`)
}

main().catch(err => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, err)
  process.exitCode = 1
})
