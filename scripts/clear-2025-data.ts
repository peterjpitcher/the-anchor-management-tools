#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'clear-2025-data'
const RUN_MUTATION_ENV = 'RUN_CLEAR_2025_DATA_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_CLEAR_2025_DATA_MUTATION_SCRIPT'
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

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const admin = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const startDate = '2025-01-01'
  const endDate = '2025-12-31'

  const { count, error: countError } = await (admin.from('cashup_sessions') as any).select('id', {
    count: 'exact',
    head: true,
  }).gte('session_date', startDate).lte('session_date', endDate)

  if (countError) {
    throw new Error(`[${SCRIPT_NAME}] failed to count cashup_sessions in range: ${countError.message || 'unknown error'}`)
  }

  const total = count ?? 0
  console.log(`[${SCRIPT_NAME}] cashup_sessions in range=${total}`)

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN ok. No mutations performed.`)
    return
  }

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

  const { data: sessionRows, error: selectError } = await (admin.from('cashup_sessions') as any)
    .select('id')
    .gte('session_date', startDate)
    .lte('session_date', endDate)
    .limit(args.limit)

  if (selectError) {
    throw new Error(`[${SCRIPT_NAME}] failed to select cashup_sessions ids: ${selectError.message || 'unknown error'}`)
  }

  const sessionIds = Array.isArray(sessionRows)
    ? sessionRows
        .map((row) => (typeof row?.id === 'string' ? row.id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  if (sessionIds.length === 0) {
    console.log(`[${SCRIPT_NAME}] no sessions found to delete (within selected limit).`)
    return
  }

  const { data: deletedRows, error: deleteError } = await (admin.from('cashup_sessions') as any)
    .delete()
    .in('id', sessionIds)
    .select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: 'Delete cashup_sessions rows',
    error: deleteError,
    updatedRows: deletedRows as Array<{ id?: string }> | null,
    allowZeroRows: false,
  })

  assertScriptExpectedRowCount({
    operation: 'Delete cashup_sessions rows',
    expected: sessionIds.length,
    actual: updatedCount,
  })

  if (total > updatedCount) {
    console.log(`[${SCRIPT_NAME}] WARNING: deleted ${updatedCount}/${total}. Re-run with a higher --limit to continue.`)
  } else {
    console.log(`[${SCRIPT_NAME}] deleted ${updatedCount} sessions (and related records via cascade).`)
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
