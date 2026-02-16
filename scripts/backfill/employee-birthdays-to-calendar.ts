#!/usr/bin/env tsx
/**
 * Backfill: sync active employee birthdays to Google Calendar (dangerous).
 *
 * Safety:
 * - Dry-run by default (no Google writes unless explicitly enabled).
 * - Mutations require multi-gating + explicit caps.
 * - Fails closed (non-zero exit) on env/query/sync failures in mutation mode.
 *
 * Usage:
 *   # Dry-run (default)
 *   scripts/backfill/employee-birthdays-to-calendar.ts [--limit 25]
 *
 *   # Mutation (dangerous)
 *   RUN_EMPLOYEE_BIRTHDAYS_CALENDAR_SYNC=true ALLOW_EMPLOYEE_BIRTHDAYS_CALENDAR_SYNC_SCRIPT=true \\
 *     scripts/backfill/employee-birthdays-to-calendar.ts --confirm --limit 25
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCalendarConfigured } from '@/lib/google-calendar'
import { syncBirthdayCalendarEvent } from '@/lib/google-calendar-birthdays'
import { assertScriptMutationAllowed, assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'employee-birthdays-to-calendar'
const RUN_MUTATION_ENV = 'RUN_EMPLOYEE_BIRTHDAYS_CALENDAR_SYNC'
const ALLOW_MUTATION_ENV = 'ALLOW_EMPLOYEE_BIRTHDAYS_CALENDAR_SYNC_SCRIPT'

const DEFAULT_LIMIT = 25
const HARD_CAP = 200

type EmployeeBirthdayRow = {
  employee_id: string
  first_name: string
  last_name: string
  job_title: string | null
  date_of_birth: string | null
  email_address: string | null
  status: string
}

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=').slice(1).join('=') || null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx === -1) return null
  const value = argv[idx + 1]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number
  explicitLimit: boolean
}

function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  const confirm = argv.includes('--confirm')
  const dryRun = !confirm || argv.includes('--dry-run')

  const limitRaw = readOptionalFlagValue(argv, '--limit')
  const explicitLimit = limitRaw !== null
  const parsedLimit = parsePositiveInt(limitRaw)

  const limit = parsedLimit ?? DEFAULT_LIMIT
  if (limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }

  return { confirm, dryRun, limit, explicitLimit }
}

async function fetchEmployeesToSync(limit: number): Promise<EmployeeBirthdayRow[]> {
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

    const rows =
      assertScriptQuerySucceeded({
        operation: `[${SCRIPT_NAME}] Load employees page offset=${offset}`,
        error,
        data: (data ?? null) as EmployeeBirthdayRow[] | null,
        allowMissing: true,
      }) ?? []

    if (rows.length === 0) {
      break
    }

    all.push(...rows)

    if (all.length >= limit) {
      return all.slice(0, limit)
    }

    if (rows.length < pageSize) {
      break
    }

    offset += pageSize
  }

  return all.slice(0, limit)
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  dotenv.config({ path: path.resolve(process.cwd(), '.env') })

  const args = parseArgs(process.argv.slice(2))
  const mutationEnabled = !args.dryRun

  console.log(`[${SCRIPT_NAME}] Mode: ${mutationEnabled ? 'MUTATION (dangerous)' : 'DRY RUN (safe)'}`)
  console.log(`[${SCRIPT_NAME}] limit: ${args.limit}${args.explicitLimit ? '' : ' (default)'} (hard cap ${HARD_CAP})`)

  if (!isCalendarConfigured()) {
    if (mutationEnabled) {
      throw new Error(`[${SCRIPT_NAME}] Google Calendar is not configured. Aborting mutation run.`)
    }
    console.log(`[${SCRIPT_NAME}] Google Calendar is not configured; dry-run exiting without calling Google.`)
    return
  }

  if (mutationEnabled) {
    if (!args.confirm) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
    }

    assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: RUN_MUTATION_ENV })
    assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

    if (!args.explicitLimit) {
      throw new Error(`[${SCRIPT_NAME}] mutation requires an explicit --limit <n> (hard cap ${HARD_CAP})`)
    }
  }

  const employees = await fetchEmployeesToSync(args.limit)
  console.log(`[${SCRIPT_NAME}] Found ${employees.length} active employees with birthdays to sync.`)

  if (employees.length === 0) {
    return
  }

  let synced = 0
  let failed = 0

  for (const employee of employees) {
    const label = `${employee.first_name} ${employee.last_name} (${employee.employee_id})`

    if (!mutationEnabled) {
      console.log(`[dry-run] would sync: ${label}`)
      continue
    }

    try {
      const eventId = await syncBirthdayCalendarEvent(employee)
      if (eventId) {
        synced += 1
        console.log(`synced: ${label}`)
      } else {
        failed += 1
        console.error(`failed: ${label}`)
      }
    } catch (error) {
      failed += 1
      console.error(`error: ${label}`, error)
    }
  }

  console.log(`[${SCRIPT_NAME}] Done. Synced: ${synced}. Failed: ${failed}.`)

  if (mutationEnabled && failed > 0) {
    throw new Error(`[${SCRIPT_NAME}] completed with ${failed} failure(s)`)
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

