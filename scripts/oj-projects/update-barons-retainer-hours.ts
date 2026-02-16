#!/usr/bin/env tsx
/**
 * Update Barons Pubs retainer included hours.
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

const SCRIPT_NAME = 'oj-update-barons-retainer-hours'
const RUN_MUTATION_ENV = 'RUN_OJ_UPDATE_BARONS_RETAINER_HOURS_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_OJ_UPDATE_BARONS_RETAINER_HOURS_MUTATION_SCRIPT'
const HARD_CAP = 200

const VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3' // Barons Pubs
const NEW_HOURS = 30

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

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)
  console.log(`[${SCRIPT_NAME}] Vendor: ${VENDOR_ID}`)
  console.log(`[${SCRIPT_NAME}] New hours: ${NEW_HOURS}`)

  const { data: projectsRaw, error: projectsError } = await supabase
    .from('oj_projects')
    .select('id')
    .eq('vendor_id', VENDOR_ID)
    .eq('is_retainer', true)

  const projects = assertScriptQuerySucceeded({
    operation: 'Load retainer projects',
    error: projectsError,
    data: projectsRaw as Array<{ id: string }> | null,
    allowMissing: true,
  }) as Array<{ id: string }>

  const projectIds = projects
    .map((row) => (typeof row?.id === 'string' ? row.id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const { data: settingsRaw, error: settingsError } = await supabase
    .from('oj_vendor_billing_settings')
    .select('vendor_id, retainer_included_hours_per_month')
    .eq('vendor_id', VENDOR_ID)
    .maybeSingle()

  const settings = assertScriptQuerySucceeded({
    operation: 'Load vendor billing settings',
    error: settingsError,
    data: settingsRaw as { vendor_id: string; retainer_included_hours_per_month: number | null } | null,
    allowMissing: true,
  })

  const settingsOp = settings ? 'update' : 'insert'
  const plannedOps = projectIds.length + 1

  console.log(`[${SCRIPT_NAME}] Retainer projects to update: ${projectIds.length}`)
  console.log(`[${SCRIPT_NAME}] Billing settings op: ${settingsOp}`)
  console.log(`[${SCRIPT_NAME}] Planned mutations: ${plannedOps}`)

  if (plannedOps === 0) {
    console.log(`[${SCRIPT_NAME}] Nothing to do.`)
    return
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN complete. No rows updated/inserted.`)
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

  if (projectIds.length > 0) {
    const { data, error } = await supabase
      .from('oj_projects')
      .update({ budget_hours: NEW_HOURS })
      .in('id', projectIds)
      .select('id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Update retainer project hours',
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: 'Update retainer project hours',
      expected: projectIds.length,
      actual: updatedCount,
    })
  }

  if (settings) {
    const { data, error } = await supabase
      .from('oj_vendor_billing_settings')
      .update({ retainer_included_hours_per_month: NEW_HOURS })
      .eq('vendor_id', VENDOR_ID)
      .select('vendor_id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Update vendor billing settings',
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: 'Update vendor billing settings',
      expected: 1,
      actual: updatedCount,
    })
  } else {
    const { data, error } = await supabase
      .from('oj_vendor_billing_settings')
      .insert({
        vendor_id: VENDOR_ID,
        retainer_included_hours_per_month: NEW_HOURS,
        billing_mode: 'full',
      })
      .select('vendor_id')

    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Insert vendor billing settings',
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: 'Insert vendor billing settings',
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
