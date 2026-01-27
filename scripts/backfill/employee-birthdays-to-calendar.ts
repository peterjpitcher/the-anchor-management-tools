/**
 * Backfill: sync all active employee birthdays to Google Calendar.
 *
 * Run with:
 * - `npx tsx scripts/backfill/employee-birthdays-to-calendar.ts`
 *
 * Options:
 * - `--dry-run`   Prints what would be synced without calling Google
 * - `--limit=25`  Only process first N employees
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv() // fallback to .env if present

import { createAdminClient } from '@/lib/supabase/admin'
import { isCalendarConfigured } from '@/lib/google-calendar'
import { syncBirthdayCalendarEvent } from '@/lib/google-calendar-birthdays'

type EmployeeBirthdayRow = {
  employee_id: string
  first_name: string
  last_name: string
  job_title: string | null
  date_of_birth: string | null
  email_address: string | null
  status: string
}

function readLimit(argv: string[]): number | null {
  const eq = argv.find((arg) => arg.startsWith('--limit='))
  if (eq) {
    const raw = eq.split('=')[1]
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  const idx = argv.findIndex((arg) => arg === '--limit')
  if (idx !== -1) {
    const raw = argv[idx + 1]
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  return null
}

async function fetchEmployeesToSync(limit: number | null): Promise<EmployeeBirthdayRow[]> {
  const supabase = createAdminClient()
  const pageSize = 500

  let offset = 0
  const all: EmployeeBirthdayRow[] = []

  while (true) {
    const { data, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, job_title, date_of_birth, email_address, status')
      .eq('status', 'Active')
      .not('date_of_birth', 'is', null)
      .order('last_name')
      .order('first_name')
      .range(offset, offset + pageSize - 1)

    if (error) {
      throw error
    }

    if (!data || data.length === 0) {
      break
    }

    all.push(...(data as EmployeeBirthdayRow[]))

    if (limit && all.length >= limit) {
      return all.slice(0, limit)
    }

    if (data.length < pageSize) {
      break
    }

    offset += pageSize
  }

  return all
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const limit = readLimit(argv)

  if (!isCalendarConfigured()) {
    console.error('Google Calendar is not configured. Set GOOGLE_CALENDAR_ID + auth vars before running this backfill.')
    process.exit(1)
  }

  const employees = await fetchEmployeesToSync(limit)
  console.log(`Found ${employees.length} active employees with birthdays to sync.`)

  if (employees.length === 0) {
    return
  }

  let synced = 0
  let failed = 0

  for (const employee of employees) {
    const label = `${employee.first_name} ${employee.last_name} (${employee.employee_id})`

    if (dryRun) {
      console.log(`[dry-run] would sync: ${label}`)
      continue
    }

    try {
      const eventId = await syncBirthdayCalendarEvent(employee)
      if (eventId) {
        synced++
        console.log(`synced: ${label}`)
      } else {
        failed++
        console.error(`failed: ${label}`)
      }
    } catch (error) {
      failed++
      console.error(`error: ${label}`, error)
    }
  }

  console.log(`Done. Synced: ${synced}. Failed: ${failed}.`)

  if (!dryRun && failed > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error)
  process.exit(1)
})

