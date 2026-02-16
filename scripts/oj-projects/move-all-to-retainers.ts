#!/usr/bin/env tsx
/**
 * Move all Barons Pubs entries into monthly retainer projects (very destructive).
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

const SCRIPT_NAME = 'oj-move-all-to-retainers'
const RUN_MUTATION_ENV = 'RUN_OJ_MOVE_ALL_TO_RETAINERS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_OJ_MOVE_ALL_TO_RETAINERS_MUTATION_SCRIPT'
const HARD_CAP = 500

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

type EntryRow = {
  id: string
  entry_date: string
  description: string | null
  project_id: string | null
}

type ProjectRow = {
  id: string
  project_name: string | null
  retainer_period_yyyymm: string | null
}

function periodForEntryDate(entryDate: string): string {
  return entryDate.substring(0, 7)
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

  const { data: vendorRaw, error: vendorError } = await supabase
    .from('invoice_vendors')
    .select('id')
    .eq('name', 'Barons Pubs')
    .maybeSingle()

  const vendor = assertScriptQuerySucceeded({
    operation: 'Load Barons Pubs vendor',
    error: vendorError,
    data: vendorRaw as { id: string } | null,
    allowMissing: false,
  }) as { id: string }

  const { data: entriesRaw, error: entriesError } = await supabase
    .from('oj_entries')
    .select('id, entry_date, description, project_id')
    .eq('vendor_id', vendor.id)

  const entries = assertScriptQuerySucceeded({
    operation: 'Load Barons entries',
    error: entriesError,
    data: entriesRaw as EntryRow[] | null,
    allowMissing: true,
  }) as EntryRow[]

  if (entries.length === 0) {
    console.log(`[${SCRIPT_NAME}] No entries found.`)
    return
  }

  const { data: existingProjectsRaw, error: projectsError } = await supabase
    .from('oj_projects')
    .select('id, project_name, retainer_period_yyyymm')
    .eq('vendor_id', vendor.id)
    .eq('is_retainer', true)

  const existingProjects = assertScriptQuerySucceeded({
    operation: 'Load existing retainer projects',
    error: projectsError,
    data: existingProjectsRaw as ProjectRow[] | null,
    allowMissing: true,
  }) as ProjectRow[]

  const projectByPeriod = new Map<string, ProjectRow>()
  for (const project of existingProjects) {
    const period = typeof project.retainer_period_yyyymm === 'string' ? project.retainer_period_yyyymm : ''
    if (period) {
      projectByPeriod.set(period, project)
    }
  }

  const periods = new Set(entries.map((e) => periodForEntryDate(e.entry_date)))
  const missingPeriods = [...periods].filter((period) => !projectByPeriod.has(period))

  const toMove = entries.filter((entry) => {
    const period = periodForEntryDate(entry.entry_date)
    const targetId = projectByPeriod.get(period)?.id ?? null
    if (!targetId) {
      return true
    }
    return entry.project_id !== targetId
  })

  const plannedOpsUpperBound = missingPeriods.length + toMove.length

  console.log(`[${SCRIPT_NAME}] Entries: ${entries.length}`)
  console.log(`[${SCRIPT_NAME}] Missing retainer projects to create: ${missingPeriods.length}`)
  console.log(`[${SCRIPT_NAME}] Entries to move: ${toMove.length}`)
  console.log(`[${SCRIPT_NAME}] Planned mutations (upper bound): ${plannedOpsUpperBound}`)

  if (plannedOpsUpperBound === 0) {
    console.log(`[${SCRIPT_NAME}] Nothing to do.`)
    return
  }

  if (args.dryRun) {
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
        vendor_id: vendor.id,
        project_name: meta.project_name,
        project_code: meta.project_code,
        status: 'active',
        is_retainer: true,
        retainer_period_yyyymm: period,
        budget_hours: 30,
      })
      .select('id, project_name, retainer_period_yyyymm')

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
    const period = periodForEntryDate(entry.entry_date)
    const targetProjectId = projectByPeriod.get(period)?.id ?? null
    if (!targetProjectId) {
      throw new Error(`[${SCRIPT_NAME}] Missing target project for period ${period}`)
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

  console.log(`[${SCRIPT_NAME}] MUTATION complete.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
