#!/usr/bin/env tsx
/**
 * Fix missing/zero hourly rate snapshots on Barons time entries.
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

const SCRIPT_NAME = 'oj-fix-entry-rates'
const RUN_MUTATION_ENV = 'RUN_OJ_FIX_ENTRY_RATES_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_OJ_FIX_ENTRY_RATES_MUTATION_SCRIPT'
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

async function selectIds(
  supabase: ReturnType<typeof createAdminClient>,
  params: { table: string; limit: number; filter: (qb: any) => any }
): Promise<string[]> {
  const qb = params.filter((supabase.from(params.table) as any).select('id')).limit(params.limit)
  const { data, error } = await qb
  const rows = assertScriptQuerySucceeded({
    operation: `Select ${params.table} ids`,
    error,
    data: data as Array<{ id: string }> | null,
    allowMissing: true,
  })

  if (!Array.isArray(rows) || rows.length === 0) return []

  return rows
    .map((row) => (typeof row?.id === 'string' ? row.id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
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

  const { data: settingsRaw, error: settingsError } = await supabase
    .from('oj_vendor_billing_settings')
    .select('hourly_rate_ex_vat')
    .eq('vendor_id', vendor.id)
    .maybeSingle()

  const settings = assertScriptQuerySucceeded({
    operation: 'Load vendor billing settings',
    error: settingsError,
    data: settingsRaw as { hourly_rate_ex_vat: number | null } | null,
    allowMissing: true,
  })

  const rate = settings?.hourly_rate_ex_vat || 62.5
  console.log(`[${SCRIPT_NAME}] Using rate: £${rate}`)

  const nullCount = await countRows(supabase, {
    table: 'oj_entries',
    filter: (qb) =>
      qb.eq('vendor_id', vendor.id).eq('entry_type', 'time').is('hourly_rate_ex_vat_snapshot', null),
  })
  const zeroCount = await countRows(supabase, {
    table: 'oj_entries',
    filter: (qb) =>
      qb.eq('vendor_id', vendor.id).eq('entry_type', 'time').eq('hourly_rate_ex_vat_snapshot', 0),
  })

  const plannedOps = nullCount + zeroCount
  console.log(`[${SCRIPT_NAME}] Rows with null snapshot: ${nullCount}`)
  console.log(`[${SCRIPT_NAME}] Rows with zero snapshot: ${zeroCount}`)
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

  if (nullCount > 0) {
    const ids = await selectIds(supabase, {
      table: 'oj_entries',
      limit: nullCount,
      filter: (qb) =>
        qb.eq('vendor_id', vendor.id).eq('entry_type', 'time').is('hourly_rate_ex_vat_snapshot', null),
    })

    if (ids.length !== nullCount) {
      throw new Error(`[${SCRIPT_NAME}] Unexpected null-rate id selection count (expected ${nullCount}, got ${ids.length})`)
    }

    const { data, error } = await supabase
      .from('oj_entries')
      .update({ hourly_rate_ex_vat_snapshot: rate })
      .in('id', ids)
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Update null-rate entries',
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: 'Update null-rate entries',
      expected: ids.length,
      actual: updatedCount,
    })
  }

  if (zeroCount > 0) {
    const ids = await selectIds(supabase, {
      table: 'oj_entries',
      limit: zeroCount,
      filter: (qb) =>
        qb.eq('vendor_id', vendor.id).eq('entry_type', 'time').eq('hourly_rate_ex_vat_snapshot', 0),
    })

    if (ids.length !== zeroCount) {
      throw new Error(`[${SCRIPT_NAME}] Unexpected zero-rate id selection count (expected ${zeroCount}, got ${ids.length})`)
    }

    const { data, error } = await supabase
      .from('oj_entries')
      .update({ hourly_rate_ex_vat_snapshot: rate })
      .in('id', ids)
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Update zero-rate entries',
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: 'Update zero-rate entries',
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
