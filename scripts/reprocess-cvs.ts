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

const SCRIPT_NAME = 'reprocess-cvs'
const RUN_MUTATION_ENV = 'RUN_REPROCESS_CVS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_REPROCESS_CVS_MUTATION_SCRIPT'
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

  const { count, error: countError } = await (admin.from('jobs') as any).select('id', {
    count: 'exact',
    head: true,
  }).eq('type', 'parse_cv').eq('status', 'completed')

  if (countError) {
    throw new Error(`[${SCRIPT_NAME}] failed to count jobs: ${countError.message || 'unknown error'}`)
  }

  const total = count ?? 0
  console.log(`[${SCRIPT_NAME}] parse_cv completed jobs=${total}`)

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

  const { data: jobRows, error: selectError } = await (admin.from('jobs') as any)
    .select('id')
    .eq('type', 'parse_cv')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(args.limit)

  const jobs = assertScriptQuerySucceeded({
    operation: 'Select jobs to reset',
    error: selectError,
    data: jobRows as Array<{ id: string }> | null,
    allowMissing: true,
  })

  const jobIds = Array.isArray(jobs)
    ? jobs
        .map((row) => (typeof row?.id === 'string' ? row.id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  if (jobIds.length === 0) {
    console.log(`[${SCRIPT_NAME}] no jobs selected to reset (within selected limit).`)
    return
  }

  const scheduledFor = new Date().toISOString()
  const { data: updatedRows, error: updateError } = await (admin.from('jobs') as any)
    .update({
      status: 'pending',
      attempts: 0,
      result: null,
      error_message: null,
      failed_at: null,
      completed_at: null,
      scheduled_for: scheduledFor,
    })
    .in('id', jobIds)
    .select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: 'Reset parse_cv completed jobs to pending',
    error: updateError,
    updatedRows: updatedRows as Array<{ id?: string }> | null,
    allowZeroRows: false,
  })

  assertScriptExpectedRowCount({
    operation: 'Reset parse_cv completed jobs to pending',
    expected: jobIds.length,
    actual: updatedCount,
  })

  if (total > updatedCount) {
    console.log(`[${SCRIPT_NAME}] WARNING: updated ${updatedCount}/${total}. Re-run with a higher --limit to continue.`)
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Updated ${updatedCount} jobs.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

