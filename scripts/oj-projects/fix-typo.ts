#!/usr/bin/env tsx
/**
 * Fix OJ work-type typo ("Consuluting" -> "Consulting") and align entry snapshots.
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

const SCRIPT_NAME = 'oj-fix-typo'
const RUN_MUTATION_ENV = 'RUN_OJ_FIX_TYPO_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_OJ_FIX_TYPO_MUTATION_SCRIPT'
const HARD_CAP = 1000

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

async function countRows(
  supabase: ReturnType<typeof createAdminClient>,
  params: { table: string; filter: (qb: any) => any }
): Promise<number> {
  const qb = params.filter((supabase.from(params.table) as any).select('id', { count: 'exact', head: true }))
  const { count, error } = await qb
  if (error) {
    throw new Error(`Failed to count ${params.table}: ${error.message || 'unknown error'}`)
  }
  return count ?? 0
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const { data: typoRowRaw, error: typoError } = await supabase
    .from('oj_work_types')
    .select('id, name')
    .eq('name', 'Consuluting')
    .maybeSingle()

  const typoRow = assertScriptQuerySucceeded({
    operation: 'Load oj_work_types typo row',
    error: typoError,
    data: typoRowRaw as { id: string; name: string } | null,
    allowMissing: true,
  })

  const entriesCount = await countRows(supabase, {
    table: 'oj_entries',
    filter: (qb) => qb.eq('work_type_name_snapshot', 'Consuluting'),
  })

  const plannedOps = (typoRow ? 1 : 0) + entriesCount
  console.log(`[${SCRIPT_NAME}] Typo row present: ${typoRow ? 'yes' : 'no'}`)
  console.log(`[${SCRIPT_NAME}] Entries with snapshot typo: ${entriesCount}`)
  console.log(`[${SCRIPT_NAME}] Planned mutations: ${plannedOps}`)

  if (plannedOps === 0) {
    console.log(`[${SCRIPT_NAME}] Nothing to do.`)
    return
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows updated.`)
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Set ${RUN_MUTATION_ENV}=true`)
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`)
    console.log(`- Provide --limit <n> (hard cap ${HARD_CAP}) where n >= ${plannedOps}`)
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
  if (plannedOps > limit) {
    throw new Error(`[${SCRIPT_NAME}] planned mutations (${plannedOps}) exceeds --limit (${limit})`)
  }

  if (typoRow) {
    const { data, error } = await supabase
      .from('oj_work_types')
      .update({ name: 'Consulting' })
      .eq('id', typoRow.id)
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: `Update oj_work_types id=${typoRow.id}`,
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: `Update oj_work_types id=${typoRow.id}`,
      expected: 1,
      actual: updatedCount,
    })
  }

  if (entriesCount > 0) {
    const { data: entryIdsRaw, error: entryIdsError } = await supabase
      .from('oj_entries')
      .select('id')
      .eq('work_type_name_snapshot', 'Consuluting')
      .limit(entriesCount)

    const entryRows = assertScriptQuerySucceeded({
      operation: 'Select oj_entries ids with typo snapshot',
      error: entryIdsError,
      data: entryIdsRaw as Array<{ id: string }> | null,
      allowMissing: false,
    }) as Array<{ id: string }>

    const ids = entryRows
      .map((row) => (typeof row?.id === 'string' ? row.id : null))
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (ids.length !== entriesCount) {
      throw new Error(
        `[${SCRIPT_NAME}] Unexpected snapshot id selection count (expected ${entriesCount}, got ${ids.length})`
      )
    }

    const { data, error } = await supabase
      .from('oj_entries')
      .update({ work_type_name_snapshot: 'Consulting' })
      .in('id', ids)
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Update oj_entries snapshot typo',
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: 'Update oj_entries snapshot typo',
      expected: ids.length,
      actual: updatedCount,
    })
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
