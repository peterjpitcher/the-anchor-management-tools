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

const SCRIPT_NAME = 'fix-bookings-is-reminder-only'
const RUN_MUTATION_ENV = 'RUN_FIX_BOOKINGS_IS_REMINDER_ONLY_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_FIX_BOOKINGS_IS_REMINDER_ONLY_MUTATION_SCRIPT'
const LEGACY_ALLOW_ENV = 'ALLOW_BOOKING_REMINDER_FLAG_FIX_SCRIPT'
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

function assertAnyMutationAllowlisted(scriptName: string): void {
  const allowEnv = isTruthyEnv(process.env[ALLOW_MUTATION_ENV])
    ? ALLOW_MUTATION_ENV
    : isTruthyEnv(process.env[LEGACY_ALLOW_ENV])
      ? LEGACY_ALLOW_ENV
      : null

  if (!allowEnv) {
    throw new Error(
      `${scriptName} blocked by safety guard. Set ${ALLOW_MUTATION_ENV}=true (or legacy ${LEGACY_ALLOW_ENV}=true) to run this mutation script.`
    )
  }

  assertScriptMutationAllowed({ scriptName, envVar: allowEnv })
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const admin = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const { count, error: countError } = await (admin.from('bookings') as any).select('id', {
    count: 'exact',
    head: true,
  }).gt('seats', 0).eq('is_reminder_only', true)

  if (countError) {
    throw new Error(`[${SCRIPT_NAME}] failed to count bookings: ${countError.message || 'unknown error'}`)
  }

  const total = count ?? 0
  console.log(`[${SCRIPT_NAME}] bookings needing fix=${total}`)

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

  assertAnyMutationAllowlisted(SCRIPT_NAME)

  const { data: bookingRows, error: fetchError } = await (admin.from('bookings') as any)
    .select('id')
    .gt('seats', 0)
    .eq('is_reminder_only', true)
    .limit(args.limit)

  const bookings = assertScriptQuerySucceeded({
    operation: 'Select bookings to fix',
    error: fetchError,
    data: bookingRows as Array<{ id: string }> | null,
    allowMissing: true,
  })

  const bookingIds = Array.isArray(bookings)
    ? bookings
        .map((row) => (typeof row?.id === 'string' ? row.id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  if (bookingIds.length === 0) {
    console.log(`[${SCRIPT_NAME}] no bookings found to update (within selected limit).`)
    return
  }

  const { data: updatedRows, error: updateError } = await (admin.from('bookings') as any)
    .update({ is_reminder_only: false })
    .in('id', bookingIds)
    .select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: 'Fix bookings is_reminder_only flag',
    error: updateError,
    updatedRows: updatedRows as Array<{ id?: string }> | null,
    allowZeroRows: false,
  })

  assertScriptExpectedRowCount({
    operation: 'Fix bookings is_reminder_only flag',
    expected: bookingIds.length,
    actual: updatedCount,
  })

  if (total > updatedCount) {
    console.log(`[${SCRIPT_NAME}] WARNING: updated ${updatedCount}/${total}. Re-run with a higher --limit to continue.`)
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Updated ${updatedCount} bookings.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
