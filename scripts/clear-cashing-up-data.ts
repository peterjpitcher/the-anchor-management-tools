#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'clear-cashing-up-data'
const RUN_MUTATION_ENV = 'RUN_CLEAR_CASHING_UP_DATA_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_CLEAR_CASHING_UP_DATA_MUTATION_SCRIPT'
const HARD_CAP = 5000

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
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))

  return { confirm, dryRun, limit }
}

async function countRows(supabase: ReturnType<typeof createAdminClient>, table: string): Promise<number> {
  const { count, error } = await (supabase.from(table) as any).select('id', { count: 'exact', head: true })
  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message || 'unknown error'}`)
  }
  return count ?? 0
}

async function selectIds(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  limit: number
): Promise<string[]> {
  const { data, error } = await (supabase.from(table) as any).select('id').limit(limit)
  const rows = assertScriptQuerySucceeded({
    operation: `Select ${table} ids`,
    error,
    data: data as Array<{ id: string }> | null,
    allowMissing: true,
  })

  if (!Array.isArray(rows) || rows.length === 0) {
    return []
  }

  return rows
    .map((row) => (typeof row?.id === 'string' ? row.id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

async function deleteByIds(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) {
    return 0
  }

  const { data, error } = await (supabase.from(table) as any).delete().in('id', ids).select('id')
  const { updatedCount } = assertScriptMutationSucceeded({
    operation: `Delete ${table} rows`,
    error,
    updatedRows: data as Array<{ id?: string }> | null,
    allowZeroRows: false,
  })

  assertScriptExpectedRowCount({
    operation: `Delete ${table} rows`,
    expected: ids.length,
    actual: updatedCount,
  })

  return updatedCount
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const tables = ['cashup_cash_counts', 'cashup_payment_breakdowns', 'cashup_sessions'] as const

  for (const table of tables) {
    const count = await countRows(supabase, table)
    console.log(`[${SCRIPT_NAME}] ${table}: ${count} row(s)`)
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows deleted.`)
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

  let deletedTotal = 0

  // Delete children first, then sessions
  for (const table of tables) {
    const ids = await selectIds(supabase, table, limit)
    if (ids.length === 0) {
      console.log(`[${SCRIPT_NAME}] ${table}: no rows selected for deletion`)
      continue
    }

    const deleted = await deleteByIds(supabase, table, ids)
    deletedTotal += deleted
    console.log(`[${SCRIPT_NAME}] ${table}: deleted ${deleted} row(s)`)
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Deleted ${deletedTotal} row(s) total.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
