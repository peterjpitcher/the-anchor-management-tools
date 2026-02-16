#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'rectify-golden-barrels'
const RUN_MUTATION_ENV = 'RUN_RECTIFY_GOLDEN_BARRELS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_RECTIFY_GOLDEN_BARRELS_MUTATION_SCRIPT'
const HARD_CAP = 50

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  return parsed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
  vendorId: string | null
  projectId: string | null
  workTypeName: string
  createMissing: boolean
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  const vendorId = findFlagValue(rest, '--vendor-id') ?? process.env.GOLDEN_BARRELS_VENDOR_ID ?? null
  const projectId = findFlagValue(rest, '--project-id') ?? process.env.GOLDEN_BARRELS_PROJECT_ID ?? null
  const workTypeName = findFlagValue(rest, '--work-type') ?? 'Development'
  const createMissing = rest.includes('--create-missing')

  return {
    confirm,
    dryRun,
    limit,
    vendorId: typeof vendorId === 'string' && vendorId.trim().length > 0 ? vendorId.trim() : null,
    projectId: typeof projectId === 'string' && projectId.trim().length > 0 ? projectId.trim() : null,
    workTypeName,
    createMissing,
  }
}

const ENTRY_PLAN = [
  { date: '2026-01-12', hours: 2, desc: 'Initial Setup & Scoping' },
  { date: '2026-01-13', hours: 5, desc: 'Frontend Architecture & Layout' },
  { date: '2026-01-14', hours: 4, desc: 'Component Development' },
  { date: '2026-01-15', hours: 6, desc: 'Core Features Implementation' },
  { date: '2026-01-16', hours: 3, desc: 'Responsive Design & Fixes' },
  { date: '2026-01-17', hours: 4, desc: 'Content Integration & Polish' },
  { date: '2026-01-18', hours: 1, desc: 'Final Deployment & Launch Checks' },
]

type InsertedIdRow = { id?: string }

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const admin = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (!args.vendorId) {
    throw new Error(`[${SCRIPT_NAME}] missing --vendor-id (or GOLDEN_BARRELS_VENDOR_ID)`)
  }
  if (!args.projectId) {
    throw new Error(`[${SCRIPT_NAME}] missing --project-id (or GOLDEN_BARRELS_PROJECT_ID)`)
  }

  if (!args.dryRun) {
    if (!args.confirm) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
    }
    if (args.limit === null) {
      throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
    }
    if (args.limit > HARD_CAP) {
      throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
    }
    if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
      throw new Error(
        `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
      )
    }
    assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })
  }

  const failures: string[] = []

  let hourlyRate = 60
  let vatRate = 20

  const { data: settingsRow, error: settingsError } = await (admin.from('oj_vendor_billing_settings') as any)
    .select('vendor_id, hourly_rate_ex_vat, vat_rate')
    .eq('vendor_id', args.vendorId)
    .maybeSingle()

  const settings = assertScriptQuerySucceeded({
    operation: 'Lookup oj_vendor_billing_settings',
    error: settingsError,
    data: settingsRow as { vendor_id: string; hourly_rate_ex_vat: number; vat_rate: number } | null,
    allowMissing: true,
  })

  if (!settings && args.dryRun) {
    console.log(`[${SCRIPT_NAME}] vendor settings missing; would create defaults with --create-missing`)
  }

  if (!settings && !args.dryRun) {
    if (!args.createMissing) {
      throw new Error(`[${SCRIPT_NAME}] vendor settings missing; pass --create-missing to allow creating it`)
    }

    const { data, error } = await (admin.from('oj_vendor_billing_settings') as any)
      .insert({
        vendor_id: args.vendorId,
        billing_mode: 'full',
        hourly_rate_ex_vat: hourlyRate,
        vat_rate: vatRate,
        mileage_rate: 0.45,
      })
      .select('vendor_id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Insert oj_vendor_billing_settings',
      error,
      updatedRows: data as Array<{ vendor_id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: 'Insert oj_vendor_billing_settings',
      expected: 1,
      actual: updatedCount,
    })
  }

  if (settings) {
    hourlyRate = settings.hourly_rate_ex_vat
    vatRate = settings.vat_rate
  }

  let workTypeId: string | null = null
  const { data: workTypeRow, error: workTypeError } = await (admin.from('oj_work_types') as any)
    .select('id, name')
    .ilike('name', args.workTypeName)
    .maybeSingle()

  const workType = assertScriptQuerySucceeded({
    operation: 'Lookup oj_work_types',
    error: workTypeError,
    data: workTypeRow as { id: string; name: string } | null,
    allowMissing: true,
  })

  workTypeId = workType?.id ?? null

  if (!workTypeId && args.dryRun) {
    console.log(`[${SCRIPT_NAME}] work type not found; would create "${args.workTypeName}" with --create-missing`)
  }

  if (!workTypeId && !args.dryRun) {
    if (!args.createMissing) {
      throw new Error(`[${SCRIPT_NAME}] work type not found; pass --create-missing to allow creating it`)
    }

    const { data, error } = await (admin.from('oj_work_types') as any)
      .insert({ name: args.workTypeName, is_active: true, sort_order: 10 })
      .select('id')
      .single()

    const created = assertScriptQuerySucceeded({
      operation: `Insert oj_work_types(${args.workTypeName})`,
      error,
      data: data as { id: string } | null,
    })

    if (!created?.id) {
      throw new Error(`[${SCRIPT_NAME}] inserted oj_work_types did not return an id`)
    }

    workTypeId = created.id
    console.log(`[${SCRIPT_NAME}] inserted work type id=${created.id}`)
  }

  if (!workTypeId) {
    if (args.dryRun) {
      console.log(`[${SCRIPT_NAME}] DRY RUN complete (missing work type; no mutations performed).`)
      return
    }
    throw new Error(`[${SCRIPT_NAME}] missing workTypeId`)
  }

  const plannedInserts: Array<{
    entry_date: string
    duration_minutes_raw: number
    description: string
    start_at: string
    end_at: string
  }> = []

  for (const entry of ENTRY_PLAN) {
    const minutes = entry.hours * 60
    const { count, error } = await (admin.from('oj_entries') as any).select('id', { count: 'exact', head: true }).eq('project_id', args.projectId).eq('entry_date', entry.date).eq('duration_minutes_raw', minutes)
    if (error) {
      throw new Error(`[${SCRIPT_NAME}] duplicate check failed for ${entry.date}: ${error.message || 'unknown error'}`)
    }
    if ((count ?? 0) > 0) {
      continue
    }
    plannedInserts.push({
      entry_date: entry.date,
      duration_minutes_raw: minutes,
      description: entry.desc,
      start_at: `${entry.date} 09:00:00`,
      end_at: `${entry.date} ${9 + entry.hours}:00:00`,
    })
  }

  console.log(`[${SCRIPT_NAME}] planned inserts=${plannedInserts.length}`)

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN ok. No mutations performed.`)
    return
  }

  const insertLimit = args.limit ?? plannedInserts.length
  const mutationInserts = plannedInserts.slice(0, insertLimit)

  for (const entry of mutationInserts) {
    try {
      const { data, error } = await (admin.from('oj_entries') as any)
        .insert({
          vendor_id: args.vendorId,
          project_id: args.projectId,
          entry_type: 'time',
          entry_date: entry.entry_date,
          start_at: entry.start_at,
          end_at: entry.end_at,
          duration_minutes_raw: entry.duration_minutes_raw,
          duration_minutes_rounded: entry.duration_minutes_raw,
          work_type_id: workTypeId,
          work_type_name_snapshot: args.workTypeName,
          description: entry.description,
          billable: true,
          status: 'unbilled',
          hourly_rate_ex_vat_snapshot: hourlyRate,
          vat_rate_snapshot: vatRate,
          mileage_rate_snapshot: 0.45,
        })
        .select('id')

      const { updatedCount } = assertScriptMutationSucceeded({
        operation: `Insert oj_entries(${entry.entry_date})`,
        error,
        updatedRows: data as InsertedIdRow[] | null,
        allowZeroRows: false,
      })

      assertScriptExpectedRowCount({
        operation: `Insert oj_entries(${entry.entry_date})`,
        expected: 1,
        actual: updatedCount,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      failures.push(`Failed to insert ${entry.entry_date}: ${message}`)
    }
  }

  assertScriptCompletedWithoutFailures({ scriptName: SCRIPT_NAME, failureCount: failures.length, failures })
  console.log(`[${SCRIPT_NAME}] MUTATION complete.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

