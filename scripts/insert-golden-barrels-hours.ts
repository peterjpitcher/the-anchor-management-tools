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

const SCRIPT_NAME = 'insert-golden-barrels-hours'
const RUN_MUTATION_ENV = 'RUN_INSERT_GOLDEN_BARRELS_HOURS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_INSERT_GOLDEN_BARRELS_HOURS_MUTATION_SCRIPT'
const HARD_CAP_ENTRIES = 50
const HARD_CAP_CLEANUP = 5000

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
  cleanup2025: boolean
  cleanupLimit: number | null
  createMissing: boolean
  vendorName: string
  projectName: string
  workTypeName: string
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  const cleanup2025 = rest.includes('--cleanup-2025')
  const cleanupLimit = parsePositiveInt(findFlagValue(rest, '--cleanup-limit'))
  const createMissing = rest.includes('--create-missing')
  const vendorName = findFlagValue(rest, '--vendor-name') ?? 'Golden Barrels'
  const projectName = findFlagValue(rest, '--project-name') ?? 'Website Build'
  const workTypeName = findFlagValue(rest, '--work-type') ?? 'Development'

  return {
    confirm,
    dryRun,
    limit,
    cleanup2025,
    cleanupLimit,
    createMissing,
    vendorName,
    projectName,
    workTypeName,
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
  console.log(
    `[${SCRIPT_NAME}] vendor="${args.vendorName}" project="${args.projectName}" workType="${args.workTypeName}" cleanup2025=${args.cleanup2025} createMissing=${args.createMissing}`
  )

  if (!args.dryRun) {
    if (!args.confirm) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
    }
    if (args.limit === null) {
      throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP_ENTRIES})`)
    }
    if (args.limit > HARD_CAP_ENTRIES) {
      throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP_ENTRIES})`)
    }
    if (args.cleanup2025) {
      if (args.cleanupLimit === null) {
        throw new Error(
          `[${SCRIPT_NAME}] cleanup requires --cleanup-limit <n> (hard cap ${HARD_CAP_CLEANUP})`
        )
      }
      if (args.cleanupLimit > HARD_CAP_CLEANUP) {
        throw new Error(`[${SCRIPT_NAME}] --cleanup-limit exceeds hard cap (max ${HARD_CAP_CLEANUP})`)
      }
    }
    if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
      throw new Error(
        `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
      )
    }
    assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })
  }

  const failures: string[] = []

  const { data: vendorRow, error: vendorError } = await (admin.from('invoice_vendors') as any)
    .select('id, name')
    .ilike('name', args.vendorName)
    .maybeSingle()

  const vendor = assertScriptQuerySucceeded({
    operation: 'Lookup invoice_vendors',
    error: vendorError,
    data: vendorRow as { id: string; name: string } | null,
    allowMissing: true,
  })

  let vendorId: string | null = vendor?.id ?? null
  if (!vendorId && args.dryRun) {
    console.log(`[${SCRIPT_NAME}] vendor not found; would create invoice_vendors("${args.vendorName}") with --create-missing`)
  }

  if (!vendorId && !args.dryRun) {
    if (!args.createMissing) {
      throw new Error(`[${SCRIPT_NAME}] vendor not found; pass --create-missing to allow creating it`)
    }

    const { data, error } = await (admin.from('invoice_vendors') as any)
      .insert({ name: args.vendorName, payment_terms: 30, is_active: true })
      .select('id, name')
      .single()

    const created = assertScriptQuerySucceeded({
      operation: 'Insert invoice_vendors',
      error,
      data: data as { id: string; name: string } | null,
    })

    if (!created?.id) {
      throw new Error(`[${SCRIPT_NAME}] inserted invoice_vendors did not return an id`)
    }

    vendorId = created.id
    console.log(`[${SCRIPT_NAME}] inserted vendor ${created.name} (${created.id})`)
  }

  let hourlyRate = 60
  let vatRate = 20

  if (vendorId) {
    const { data: settingsRow, error: settingsError } = await (admin.from('oj_vendor_billing_settings') as any)
      .select('vendor_id, hourly_rate_ex_vat, vat_rate')
      .eq('vendor_id', vendorId)
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
          vendor_id: vendorId,
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
  }

  let projectId: string | null = null
  if (vendorId) {
    const { data: projectRow, error: projectError } = await (admin.from('oj_projects') as any)
      .select('id, project_name')
      .eq('vendor_id', vendorId)
      .ilike('project_name', args.projectName)
      .maybeSingle()

    const project = assertScriptQuerySucceeded({
      operation: 'Lookup oj_projects',
      error: projectError,
      data: projectRow as { id: string; project_name: string } | null,
      allowMissing: true,
    })

    projectId = project?.id ?? null

    if (!projectId && args.dryRun) {
      console.log(`[${SCRIPT_NAME}] project not found; would create "${args.projectName}" with --create-missing`)
    }

    if (!projectId && !args.dryRun) {
      if (!args.createMissing) {
        throw new Error(`[${SCRIPT_NAME}] project not found; pass --create-missing to allow creating it`)
      }

      const code = `OJP-GB-${Date.now().toString(36).toUpperCase()}`
      const { data, error } = await (admin.from('oj_projects') as any)
        .insert({
          vendor_id: vendorId,
          project_name: args.projectName,
          project_code: code,
          status: 'active',
          budget_ex_vat: 3500,
        })
        .select('id')
        .single()

      const created = assertScriptQuerySucceeded({
        operation: `Insert oj_projects(${args.projectName})`,
        error,
        data: data as { id: string } | null,
      })

      if (!created?.id) {
        throw new Error(`[${SCRIPT_NAME}] inserted oj_projects did not return an id`)
      }

      projectId = created.id
      console.log(`[${SCRIPT_NAME}] inserted project id=${created.id}`)
    }
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

  if (!vendorId || !projectId || !workTypeId) {
    if (args.dryRun) {
      console.log(`[${SCRIPT_NAME}] DRY RUN complete (missing prerequisites; no mutations performed).`)
      return
    }
    throw new Error(`[${SCRIPT_NAME}] missing prerequisites (vendorId/projectId/workTypeId)`)
  }

  let cleanupCount = 0
  let cleanupIds: string[] = []
  if (args.cleanup2025) {
    const { count, error } = await (admin.from('oj_entries') as any).select('id', { count: 'exact', head: true }).eq('project_id', projectId).gte('entry_date', '2025-01-01').lte('entry_date', '2025-12-31')
    if (error) {
      throw new Error(`[${SCRIPT_NAME}] failed counting 2025 entries: ${error.message || 'unknown error'}`)
    }
    cleanupCount = count ?? 0

    if (!args.dryRun) {
      const { data, error: selectError } = await (admin.from('oj_entries') as any)
        .select('id')
        .eq('project_id', projectId)
        .gte('entry_date', '2025-01-01')
        .lte('entry_date', '2025-12-31')
        .limit(args.cleanupLimit ?? HARD_CAP_CLEANUP)
      const rows = assertScriptQuerySucceeded({
        operation: 'Select 2025 oj_entries ids',
        error: selectError,
        data: data as Array<{ id: string }> | null,
        allowMissing: true,
      })
      cleanupIds = Array.isArray(rows)
        ? rows
            .map((row) => (typeof row?.id === 'string' ? row.id : null))
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
    }
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
    const { count, error } = await (admin.from('oj_entries') as any).select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('entry_date', entry.date).eq('duration_minutes_raw', minutes)
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
  if (args.cleanup2025) {
    console.log(`[${SCRIPT_NAME}] planned cleanup 2025 entries count=${cleanupCount}`)
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN ok. No mutations performed.`)
    return
  }

  if (args.cleanup2025 && cleanupIds.length > 0) {
    const { data, error } = await (admin.from('oj_entries') as any).delete().in('id', cleanupIds).select('id')
    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Delete 2025 oj_entries rows',
      error,
      updatedRows: data as InsertedIdRow[] | null,
      allowZeroRows: false,
    })
    assertScriptExpectedRowCount({
      operation: 'Delete 2025 oj_entries rows',
      expected: cleanupIds.length,
      actual: updatedCount,
    })
    if (cleanupCount > updatedCount) {
      console.log(
        `[${SCRIPT_NAME}] WARNING: deleted ${updatedCount}/${cleanupCount} 2025 entries (cap enforced).`
      )
    }
  }

  const insertLimit = args.limit ?? plannedInserts.length
  const mutationInserts = plannedInserts.slice(0, insertLimit)
  for (const entry of mutationInserts) {
    try {
      const { data, error } = await (admin.from('oj_entries') as any)
        .insert({
          vendor_id: vendorId,
          project_id: projectId,
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

