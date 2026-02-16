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

const SCRIPT_NAME = 'seed-cashup-targets'
const RUN_MUTATION_ENV = 'RUN_SEED_CASHUP_TARGETS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_SEED_CASHUP_TARGETS_MUTATION_SCRIPT'
const HARD_CAP = 7

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
  siteId: string | null
  effectiveFrom: string
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  const siteId = findFlagValue(rest, '--site-id')
  const effectiveFrom = findFlagValue(rest, '--effective-from') ?? '2024-01-01'

  return {
    confirm,
    dryRun,
    limit,
    siteId: typeof siteId === 'string' && siteId.trim().length > 0 ? siteId.trim() : null,
    effectiveFrom,
  }
}

const DEFAULT_TARGETS = [
  { day_of_week: 1, amount: 350 },
  { day_of_week: 2, amount: 450 },
  { day_of_week: 3, amount: 600 },
  { day_of_week: 4, amount: 600 },
  { day_of_week: 5, amount: 950 },
  { day_of_week: 6, amount: 1400 },
  { day_of_week: 0, amount: 800 },
]

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const admin = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (!args.siteId) {
    throw new Error(`[${SCRIPT_NAME}] missing --site-id`)
  }

  const { data: siteRow, error: siteError } = await (admin.from('sites') as any)
    .select('id, name')
    .eq('id', args.siteId)
    .maybeSingle()
  const site = assertScriptQuerySucceeded({
    operation: 'Load sites row',
    error: siteError,
    data: siteRow as { id: string; name: string } | null,
  })
  if (!site) {
    throw new Error(`[${SCRIPT_NAME}] site not found for id=${args.siteId}`)
  }

  const rows = DEFAULT_TARGETS.map((target) => ({
    site_id: args.siteId,
    day_of_week: target.day_of_week,
    target_amount: target.amount,
    effective_from: args.effectiveFrom,
  }))

  console.log(`[${SCRIPT_NAME}] site=${site.name} (${site.id}) effective_from=${args.effectiveFrom}`)
  console.log(`[${SCRIPT_NAME}] planned targets=${rows.length}`)

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

  const mutationRows = rows.slice(0, args.limit)
  const { data: upsertedRows, error: upsertError } = await (admin.from('cashup_targets') as any)
    .upsert(mutationRows, { onConflict: 'site_id, day_of_week, effective_from' })
    .select('site_id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: 'Upsert cashup_targets rows',
    error: upsertError,
    updatedRows: upsertedRows as Array<{ site_id?: string }> | null,
    allowZeroRows: false,
  })

  assertScriptExpectedRowCount({
    operation: 'Upsert cashup_targets rows',
    expected: mutationRows.length,
    actual: updatedCount,
  })

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Upserted ${updatedCount} targets.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
