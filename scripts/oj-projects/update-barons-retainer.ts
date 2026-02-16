#!/usr/bin/env tsx
/**
 * Barons retainer migration helper.
 *
 * Ensures monthly retainer projects exist for a fixed set of months, then:
 * - moves certain time entries into the correct month retainer project
 * - inserts matching mileage entries for transit rows (if missing)
 *
 * Safety:
 * - DRY RUN by default.
 * - Mutations require --confirm + env gates + explicit caps.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-update-barons-retainer'
const RUN_MUTATION_ENV = 'RUN_OJ_UPDATE_BARONS_RETAINER_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_OJ_UPDATE_BARONS_RETAINER_MUTATION_SCRIPT'
const HARD_CAP = 500

const VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3' // Barons Pubs
const RET_MONTHS = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01'] as const
const TRANSIT_WORK_TYPE_ID = '55f8821f-d3b3-4550-a4fe-d0321bc59ef4'

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
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[${SCRIPT_NAME}] Invalid positive integer: "${raw}"`)
  }

  return parsed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))

  return { confirm, dryRun, limit }
}

type ProjectRow = {
  id: string
  retainer_period_yyyymm: string | null
  project_name: string | null
}

type EntryRow = {
  id: string
  entry_date: string
  description: string | null
  project_id: string | null
  work_type_id: string | null
  entry_type: string
  status: string | null
  paid_at: string | null
}

function projectMetaForPeriod(period: string): { project_name: string; project_code: string } {
  const [year, month] = period.split('-')
  const date = new Date(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, 1)
  const monthName = date.toLocaleString('default', { month: 'long' })
  return {
    project_name: `Monthly Retainer - ${monthName} ${year}`,
    project_code: `RET-BAR-${year}-${month}`,
  }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)
  console.log(`[${SCRIPT_NAME}] Vendor: ${VENDOR_ID}`)
  console.log(`[${SCRIPT_NAME}] Months: ${RET_MONTHS.join(', ')}`)

  const { data: existingProjectsRaw, error: existingProjectsError } = await supabase
    .from('oj_projects')
    .select('id, retainer_period_yyyymm, project_name')
    .eq('vendor_id', VENDOR_ID)
    .eq('is_retainer', true)
    .in('retainer_period_yyyymm', [...RET_MONTHS])

  const existingProjects = assertScriptQuerySucceeded({
    operation: 'Load existing retainer projects',
    error: existingProjectsError,
    data: existingProjectsRaw as ProjectRow[] | null,
    allowMissing: true,
  }) as ProjectRow[]

  const projectByPeriod = new Map<string, ProjectRow>()
  for (const row of existingProjects) {
    const period = typeof row.retainer_period_yyyymm === 'string' ? row.retainer_period_yyyymm : ''
    if (period) {
      projectByPeriod.set(period, row)
    }
  }

  const missingPeriods = [...RET_MONTHS].filter((period) => !projectByPeriod.has(period))

  const { data: entriesRaw, error: entriesError } = await supabase
    .from('oj_entries')
    .select('id, entry_date, description, project_id, work_type_id, entry_type, status, paid_at')
    .eq('vendor_id', VENDOR_ID)

  const entries = assertScriptQuerySucceeded({
    operation: 'Load Barons entries',
    error: entriesError,
    data: entriesRaw as EntryRow[] | null,
    allowMissing: true,
  }) as EntryRow[]

  const toMove: Array<{ id: string; targetProjectPeriod: string }> = []
  const transitCandidates: Array<{ entry: EntryRow; targetProjectPeriod: string }> = []

  for (const entry of entries) {
    if (entry.entry_type !== 'time') {
      continue
    }

    const entryMonth = entry.entry_date.substring(0, 7)
    if (!RET_MONTHS.includes(entryMonth as any)) {
      continue
    }

    const desc = (entry.description || '').toLowerCase()
    const isMarketingScrum = desc.includes('marketing scrum')
    const isTransit = entry.work_type_id === TRANSIT_WORK_TYPE_ID || desc.includes('drive')

    if (!isMarketingScrum && !isTransit) {
      continue
    }

    const targetProjectId = projectByPeriod.get(entryMonth)?.id ?? null
    if (!targetProjectId || entry.project_id !== targetProjectId) {
      toMove.push({ id: entry.id, targetProjectPeriod: entryMonth })
    }

    if (isTransit) {
      transitCandidates.push({ entry, targetProjectPeriod: entryMonth })
    }
  }

  const maxMileageInserts = transitCandidates.length
  const plannedOpsUpperBound = missingPeriods.length + toMove.length + maxMileageInserts

  console.log(`[${SCRIPT_NAME}] Missing projects to create: ${missingPeriods.length}`)
  console.log(`[${SCRIPT_NAME}] Entries to move: ${toMove.length}`)
  console.log(`[${SCRIPT_NAME}] Transit candidates (max mileage inserts): ${maxMileageInserts}`)
  console.log(`[${SCRIPT_NAME}] Planned mutations (upper bound): ${plannedOpsUpperBound}`)

  if (plannedOpsUpperBound === 0) {
    console.log(`[${SCRIPT_NAME}] Nothing to do.`)
    return
  }

  if (args.dryRun) {
    if (missingPeriods.length > 0) {
      console.log(`[${SCRIPT_NAME}] Missing periods: ${missingPeriods.join(', ')}`)
    }

    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows inserted/updated.`)
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Set ${RUN_MUTATION_ENV}=true`)
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`)
    console.log(`- Provide --limit <n> (hard cap ${HARD_CAP}) where n >= ${plannedOpsUpperBound}`)
    return
  }

  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  }

  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(
      `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
    )
  }

  assertScriptMutationAllowed({
    scriptName: SCRIPT_NAME,
    envVar: ALLOW_MUTATION_ENV,
  })

  const limit = args.limit
  if (!limit) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
  }
  if (limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }
  if (plannedOpsUpperBound > limit) {
    throw new Error(`[${SCRIPT_NAME}] planned mutations (${plannedOpsUpperBound}) exceeds --limit (${limit})`)
  }

  // 1) Create missing projects
  for (const period of missingPeriods) {
    const meta = projectMetaForPeriod(period)
    const { data, error } = await supabase
      .from('oj_projects')
      .insert({
        vendor_id: VENDOR_ID,
        project_name: meta.project_name,
        project_code: meta.project_code,
        is_retainer: true,
        retainer_period_yyyymm: period,
        status: 'active',
        budget_hours: 10,
      })
      .select('id, retainer_period_yyyymm, project_name')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: `Insert retainer project period=${period}`,
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: `Insert retainer project period=${period}`,
      expected: 1,
      actual: updatedCount,
    })

    const inserted = (data && data[0]) as ProjectRow | undefined
    if (!inserted?.id || !inserted?.retainer_period_yyyymm) {
      throw new Error(`[${SCRIPT_NAME}] Inserted project missing id/period for ${period}`)
    }
    projectByPeriod.set(inserted.retainer_period_yyyymm, inserted)
  }

  // 2) Move entries
  for (const entry of toMove) {
    const targetProjectId = projectByPeriod.get(entry.targetProjectPeriod)?.id ?? null
    if (!targetProjectId) {
      throw new Error(`[${SCRIPT_NAME}] Missing target project for period ${entry.targetProjectPeriod}`)
    }

    const { data, error } = await supabase
      .from('oj_entries')
      .update({ project_id: targetProjectId })
      .eq('id', entry.id)
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: `Move entry id=${entry.id}`,
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: `Move entry id=${entry.id}`,
      expected: 1,
      actual: updatedCount,
    })
  }

  // 3) Resolve + insert mileage entries
  const mileageToInsert: Array<{
    entry_date: string
    project_id: string
    description: string
    status: string | null
    paid_at: string | null
  }> = []

  for (const candidate of transitCandidates) {
    const targetProjectId = projectByPeriod.get(candidate.targetProjectPeriod)?.id ?? null
    if (!targetProjectId) {
      throw new Error(`[${SCRIPT_NAME}] Missing target project for period ${candidate.targetProjectPeriod}`)
    }

    const { data: existingMileageRaw, error } = await supabase
      .from('oj_entries')
      .select('id')
      .eq('project_id', targetProjectId)
      .eq('entry_type', 'mileage')
      .eq('entry_date', candidate.entry.entry_date)
      .eq('miles', 28)
      .maybeSingle()

    const existingMileage = assertScriptQuerySucceeded({
      operation: 'Lookup existing mileage entry',
      error,
      data: existingMileageRaw as { id: string } | null,
      allowMissing: true,
    })

    if (!existingMileage) {
      mileageToInsert.push({
        entry_date: candidate.entry.entry_date,
        project_id: targetProjectId,
        description: `Mileage for: ${candidate.entry.description || ''}`,
        status: candidate.entry.status,
        paid_at: candidate.entry.paid_at,
      })
    }
  }

  console.log(`[${SCRIPT_NAME}] Mileage inserts after lookup: ${mileageToInsert.length}`)

  for (const planned of mileageToInsert) {
    const { data, error } = await supabase
      .from('oj_entries')
      .insert({
        vendor_id: VENDOR_ID,
        project_id: planned.project_id,
        entry_type: 'mileage',
        entry_date: planned.entry_date,
        miles: 28,
        description: planned.description,
        status: planned.status,
        paid_at: planned.paid_at,
        billable: true,
        mileage_rate_snapshot: 0.42,
      })
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: `Insert mileage entry date=${planned.entry_date} project=${planned.project_id}`,
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: `Insert mileage entry date=${planned.entry_date} project=${planned.project_id}`,
      expected: 1,
      actual: updatedCount,
    })
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
