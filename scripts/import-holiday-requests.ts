#!/usr/bin/env tsx
/**
 * import-holiday-requests.ts
 *
 * Imports all time-off requests from the Rota management export CSV into the
 * leave_requests (and leave_days) tables.
 *
 * Rules:
 *  - Matches employees by email (case-insensitive), falling back to full-name match.
 *  - Employees not found in the system are created as Former employees with their
 *    name and email from the CSV. `job_title` is set to 'Not Specified' and
 *    `employment_start_date` is set to the earliest leave date for that person.
 *  - Status mapping:
 *      Approved  → approved
 *      Pending   → pending
 *      Expired   → declined  (request expired without approval)
 *      Canceled  → declined  (request was cancelled)
 *      Denied    → declined
 *  - Duplicate detection: skip any row where a leave_request already exists for
 *    the same (employee_id, start_date, end_date) regardless of status.
 *  - Non-Holiday types (Sick, Personal) are imported with the type prepended to
 *    the note, e.g. "[Sick] call in sick".
 *  - leave_days rows are written for approved and pending requests only.
 *  - No emails are sent — this is a silent historical import.
 *
 * Usage:
 *   npx tsx scripts/import-holiday-requests.ts            # dry run (safe)
 *   npx tsx scripts/import-holiday-requests.ts --confirm  # live run
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs/promises'
import Papa from 'papaparse'
import { eachDayOfInterval, parseISO, getYear } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCRIPT_NAME = 'import-holiday-requests'
const CSV_PATH = path.resolve(
  process.cwd(),
  'temp/Time-Off Requests for Jan 1, 2024 - Nov 30, 2027.csv',
)

// UK tax-year defaults (6 April); fetched from DB at runtime if available
const DEFAULT_HOLIDAY_YEAR_START_MONTH = 4
const DEFAULT_HOLIDAY_YEAR_START_DAY = 6

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeaveStatus = 'approved' | 'pending' | 'declined'

interface CsvRow {
  Name: string
  'Employee ID': string
  Email: string
  'Submitted By': string
  Type: string
  'Created At': string
  'Start Date': string
  'Start Time': string
  'End Date': string
  'End Time': string
  'Paid Hours': string
  'Unpaid Hours': string
  Status: string
  'Approved / Denied By': string
  'Approved / Denied At': string
  Message: string
}

interface EmployeeRow {
  employee_id: string
  first_name: string
  last_name: string
  email_address: string | null
  status: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStatus(csvStatus: string): LeaveStatus {
  switch (csvStatus.trim().toLowerCase()) {
    case 'approved':  return 'approved'
    case 'pending':   return 'pending'
    case 'expired':
    case 'canceled':
    case 'cancelled':
    case 'denied':
    default:          return 'declined'
  }
}

/** Parse the date portion from a CSV date field ("2026-07-19" or "2026-07-19 3:09 pm") */
function parseDateField(raw: string): string | null {
  if (!raw) return null
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** Split "First Last" or "First Middle Last" into first / last parts */
function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return { first_name: fullName.trim(), last_name: '' }
  const first_name = parts[0]
  const last_name = parts.slice(1).join(' ')
  return { first_name, last_name }
}

/**
 * Determine which holiday year a date falls into.
 * The year returned is the *start* year of the holiday period.
 * E.g. with startMonth=4, startDay=6:
 *   2025-01-01 → year 2024 (falls before 6 Apr 2025)
 *   2025-06-01 → year 2025 (falls after 6 Apr 2025)
 */
function getHolidayYear(dateStr: string, startMonth: number, startDay: number): number {
  const date = parseISO(dateStr)
  const year = getYear(date)
  const yearStart = new Date(year, startMonth - 1, startDay)
  return date >= yearStart ? year : year - 1
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
  console.log(`[1/6] Reading CSV…`)
  const csvContent = await fs.readFile(CSV_PATH, 'utf-8')
  const { data: rows, errors: parseErrors } = Papa.parse<CsvRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
  })
  if (parseErrors.length) {
    console.warn(`      CSV parse warnings:`, parseErrors)
  }
  console.log(`      ${rows.length} rows loaded`)

  // -------------------------------------------------------------------------
  // 2. Fetch holiday-year settings
  // -------------------------------------------------------------------------
  console.log(`[2/6] Fetching holiday-year settings…`)
  let startMonth = DEFAULT_HOLIDAY_YEAR_START_MONTH
  let startDay = DEFAULT_HOLIDAY_YEAR_START_DAY
  try {
    const { data: settings } = await admin
      .from('settings')
      .select('key, value')
      .in('key', ['rota_holiday_year_start_month', 'rota_holiday_year_start_day'])
    for (const row of settings ?? []) {
      const v = (row.value as { value?: number })?.value ?? row.value
      if (row.key === 'rota_holiday_year_start_month' && typeof v === 'number') startMonth = v
      if (row.key === 'rota_holiday_year_start_day' && typeof v === 'number') startDay = v
    }
  } catch {
    console.log(`      Could not read DB settings; using defaults`)
  }
  console.log(`      Holiday year starts: ${startDay}/${startMonth} (dd/mm)`)

  // -------------------------------------------------------------------------
  // 3. Load existing employees
  // -------------------------------------------------------------------------
  console.log(`[3/6] Loading existing employees…`)
  const { data: existingEmployees, error: empError } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, email_address, status')
  if (empError) throw new Error(`Failed to fetch employees: ${empError.message}`)

  const byEmail = new Map<string, EmployeeRow>()
  const byName  = new Map<string, EmployeeRow>()
  for (const emp of (existingEmployees ?? []) as EmployeeRow[]) {
    if (emp.email_address) byEmail.set(emp.email_address.toLowerCase().trim(), emp)
    const full = `${emp.first_name} ${emp.last_name}`.toLowerCase().trim()
    byName.set(full, emp)
  }
  console.log(`      ${existingEmployees?.length ?? 0} employees in system`)

  // -------------------------------------------------------------------------
  // 4. Match CSV employees → system employees; collect unknowns
  // -------------------------------------------------------------------------
  console.log(`[4/6] Matching CSV employees to system records…`)

  // Unique employees in CSV keyed by full name
  const csvPeople = new Map<string, { email: string; earliestDate: string }>()
  for (const row of rows) {
    const name = row.Name?.trim()
    if (!name) continue
    const email = row.Email?.trim().toLowerCase() ?? ''
    const startDate = parseDateField(row['Start Date']) ?? '2024-01-01'
    const existing = csvPeople.get(name)
    csvPeople.set(name, {
      email,
      earliestDate: (!existing || startDate < existing.earliestDate) ? startDate : existing.earliestDate,
    })
  }

  // employee_id map: CSV name → employee_id (populated during matching + creation)
  const employeeIdMap = new Map<string, string>()

  const toCreate: Array<{
    csvName: string
    first_name: string
    last_name: string
    email: string
    earliestDate: string
  }> = []

  for (const [csvName, { email, earliestDate }] of csvPeople) {
    const { first_name, last_name } = splitName(csvName)

    // 1. Match by email
    let found = email ? byEmail.get(email) : undefined

    // 2. Fall back to full name match
    if (!found) {
      const fullKey = `${first_name} ${last_name}`.toLowerCase().trim()
      found = byName.get(fullKey)
    }

    if (found) {
      employeeIdMap.set(csvName, found.employee_id)
      console.log(`      ✓ MATCH    "${csvName}" → ${found.employee_id} [${found.status}]`)
    } else {
      toCreate.push({ csvName, first_name, last_name, email, earliestDate })
      console.log(`      + NEW      "${csvName}" (${email}) → will create as Former`)
    }
  }

  // -------------------------------------------------------------------------
  // 5. Create missing employees
  // -------------------------------------------------------------------------
  if (toCreate.length > 0) {
    console.log(`\n[5/6] Creating ${toCreate.length} new Former employee(s)…`)
    for (const emp of toCreate) {
      if (isDryRun) {
        console.log(`      DRY RUN  Would create: "${emp.csvName}" (${emp.email}) status=Former`)
        // Leave employeeIdMap empty — rows for this person will be counted but not inserted
      } else {
        const { data: created, error: createErr } = await admin
          .from('employees')
          .insert({
            first_name: emp.first_name,
            last_name:  emp.last_name,
            email_address: emp.email || null,
            status: 'Former',
            job_title: 'Not Specified',
            employment_start_date: emp.earliestDate,
          })
          .select('employee_id, first_name, last_name')
          .single()

        if (createErr) {
          console.error(`      ✗ FAILED creating "${emp.csvName}": ${createErr.message}`)
        } else {
          employeeIdMap.set(emp.csvName, created.employee_id)
          console.log(`      ✓ CREATED "${emp.csvName}" → ${created.employee_id}`)
        }
      }
    }
  } else {
    console.log(`[5/6] No new employees to create`)
  }

  // -------------------------------------------------------------------------
  // 6. Check existing leave requests to avoid duplicates
  // -------------------------------------------------------------------------
  console.log(`\n[6/6] Importing leave requests…`)
  const { data: existingLeave } = await admin
    .from('leave_requests')
    .select('employee_id, start_date, end_date')

  const existingSet = new Set<string>()
  for (const req of existingLeave ?? []) {
    existingSet.add(`${req.employee_id}|${req.start_date}|${req.end_date}`)
  }
  console.log(`      ${existingSet.size} existing leave requests (used for duplicate check)`)
  console.log('')

  // -------------------------------------------------------------------------
  // 7. Process each CSV row
  // -------------------------------------------------------------------------
  let imported = 0
  let skippedDupe = 0
  let skippedNoEmployee = 0
  let skippedBadDate = 0
  let errors = 0

  for (const row of rows) {
    const csvName  = row.Name?.trim()
    const startDate = parseDateField(row['Start Date'])
    const endDate   = parseDateField(row['End Date'])
    const type      = row.Type?.trim() ?? 'Holiday'
    const csvStatus = row.Status?.trim() ?? ''
    const message   = row.Message?.trim() || null

    // --- Validate dates
    if (!startDate || !endDate) {
      console.log(`  SKIP [bad-date]   "${csvName}" — unparseable dates: "${row['Start Date']}" → "${row['End Date']}"`)
      skippedBadDate++
      continue
    }

    // --- Validate employee
    const employeeId = employeeIdMap.get(csvName)
    if (!employeeId) {
      // In dry-run this is expected for newly-created employees
      console.log(`  SKIP [no-emp]     "${csvName}" ${startDate}→${endDate} — employee not resolved${isDryRun ? ' (dry run: not yet created)' : ''}`)
      skippedNoEmployee++
      continue
    }

    // --- Duplicate check
    const dupeKey = `${employeeId}|${startDate}|${endDate}`
    if (existingSet.has(dupeKey)) {
      console.log(`  SKIP [duplicate]  "${csvName}" ${startDate}→${endDate}`)
      skippedDupe++
      continue
    }

    const status = mapStatus(csvStatus)
    const holidayYear = getHolidayYear(startDate, startMonth, startDay)

    // Build note — prefix with type if it's not a standard Holiday
    let note: string | null = message
    if (type !== 'Holiday') {
      note = message ? `[${type}] ${message}` : `[${type}]`
    }

    if (isDryRun) {
      console.log(
        `  IMPORT [dry-run]  "${csvName}"  ${startDate} → ${endDate}  ` +
        `status=${status}  type=${type}  year=${holidayYear}` +
        (note ? `  note="${note.slice(0, 60)}"` : ''),
      )
      existingSet.add(dupeKey) // prevent duplicate reporting within same run
      imported++
      continue
    }

    // --- Live insert
    const { data: request, error: reqErr } = await admin
      .from('leave_requests')
      .insert({
        employee_id:  employeeId,
        start_date:   startDate,
        end_date:     endDate,
        note:         note,
        holiday_year: holidayYear,
        status,
        reviewed_by:  null,
        reviewed_at:  null,
        created_by:   null,
      })
      .select('id')
      .single()

    if (reqErr) {
      console.error(`  ✗ ERROR  "${csvName}" ${startDate}→${endDate}: ${reqErr.message}`)
      errors++
      continue
    }

    // --- Insert leave_days (only for approved/pending — declined have no active days)
    if (status !== 'declined') {
      const days = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })
      const dayRows = days.map(d => ({
        request_id:  request.id,
        employee_id: employeeId,
        leave_date:  d.toISOString().split('T')[0],
      }))

      const { error: daysErr } = await admin
        .from('leave_days')
        .upsert(dayRows, { onConflict: 'employee_id,leave_date', ignoreDuplicates: true })

      if (daysErr) {
        console.warn(`  ⚠ leave_days warning for "${csvName}" ${startDate}: ${daysErr.message}`)
      }
    }

    existingSet.add(dupeKey)
    imported++
    console.log(`  ✓ IMPORTED  "${csvName}"  ${startDate} → ${endDate}  status=${status}  type=${type}  year=${holidayYear}`)
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('')
  console.log(`╔══════════════════════════════════════════════════╗`)
  console.log(`║  Summary`)
  console.log(`║`)
  console.log(`║  Imported:          ${String(imported).padStart(4)}`)
  console.log(`║  Skipped (dupes):   ${String(skippedDupe).padStart(4)}`)
  console.log(`║  Skipped (no emp):  ${String(skippedNoEmployee).padStart(4)}  ${isDryRun && toCreate.length ? '← expected in dry run' : ''}`)
  console.log(`║  Skipped (dates):   ${String(skippedBadDate).padStart(4)}`)
  console.log(`║  Errors:            ${String(errors).padStart(4)}`)
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
