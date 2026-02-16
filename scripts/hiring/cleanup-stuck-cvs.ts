#!/usr/bin/env tsx
/**
 * Hiring CV cleanup (safe by default).
 *
 * This script updates `hiring_candidates` rows that appear stuck in a placeholder
 * "Parsing CV..." state for > 30 minutes.
 *
 * Safety:
 * - Dry-run by default (no DB mutations unless explicitly enabled).
 * - Mutations require multi-gating + explicit caps.
 * - Fail closed: any query/update failure exits non-zero.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptMutationAllowed, assertScriptMutationSucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'cleanup-stuck-cvs'
const RUN_MUTATION_ENV = 'RUN_CLEANUP_STUCK_CVS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_CLEANUP_STUCK_CVS_MUTATION_SCRIPT'
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

type CandidateRow = {
  id: string
  created_at: string
}

function minutesSince(iso: string): number {
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return Number.NaN
  return (Date.now() - ts) / 1000 / 60
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const { data: allParsing, error: fetchError } = await supabase
    .from('hiring_candidates')
    .select('id, created_at')
    .eq('first_name', 'Parsing')
    .eq('last_name', 'CV...')

  if (fetchError) {
    throw new Error(`[${SCRIPT_NAME}] Failed to fetch candidates: ${fetchError.message}`)
  }

  const rows = (allParsing ?? []) as CandidateRow[]
  console.log(`[${SCRIPT_NAME}] Total candidates in 'Parsing CV...' state: ${rows.length}`)

  const thresholdIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  console.log(`[${SCRIPT_NAME}] Threshold: created_at < ${thresholdIso} (30 mins ago)`)

  const stuck = rows.filter((row) => typeof row.created_at === 'string' && row.created_at < thresholdIso)
  console.log(`[${SCRIPT_NAME}] Candidates to update (older than threshold): ${stuck.length}`)

  for (const row of stuck.slice(0, 10)) {
    const age = minutesSince(row.created_at)
    const ageLabel = Number.isFinite(age) ? `${age.toFixed(1)} min` : 'unknown age'
    console.log(`[${SCRIPT_NAME}] candidate=${row.id} created_at=${row.created_at} age=${ageLabel}`)
  }

  if (stuck.length === 0) {
    console.log(`[${SCRIPT_NAME}] No stuck candidates found.`)
    return
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows updated.`)
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Set ${RUN_MUTATION_ENV}=true`)
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`)
    console.log(`- Provide --limit <n> (hard cap ${HARD_CAP})`)
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

  const planned = stuck.slice(0, limit)
  console.log(`[${SCRIPT_NAME}] Updating ${planned.length} candidate(s) (capped by --limit=${limit})...`)

  const failures: string[] = []

  for (const candidate of planned) {
    const { data, error } = await supabase
      .from('hiring_candidates')
      .update({
        first_name: '[Parsing Failed]',
        last_name: 'Check Details',
        parsed_data: {
          error: 'Automatically marked as failed by cleanup script',
          failed_at: new Date().toISOString(),
        },
      })
      .eq('id', candidate.id)
      .select('id')

    try {
      const { updatedCount } = assertScriptMutationSucceeded({
        operation: `Update hiring_candidates candidate=${candidate.id}`,
        error,
        updatedRows: (data ?? null) as Array<{ id?: string }> | null,
        allowZeroRows: false,
      })

      if (updatedCount !== 1) {
        throw new Error(`unexpected updated row count (expected 1, got ${updatedCount})`)
      }
    } catch (err) {
      failures.push(`${candidate.id}: ${(err as Error).message}`)
      continue
    }

    console.log(`[${SCRIPT_NAME}] Updated candidate=${candidate.id}`)
  }

  if (failures.length > 0) {
    throw new Error(`[${SCRIPT_NAME}] completed with ${failures.length} failure(s): ${failures.slice(0, 3).join(' | ')}`)
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Updated ${planned.length} candidate(s).`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
