#!/usr/bin/env tsx
/**
 * Golden Barrels vendor diagnostics (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-check-golden-barrels'

type Args = {
  confirm: boolean
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  return { confirm: rest.includes('--confirm') }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  if (args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] This script is strictly read-only and does not support --confirm`)
  }

  const supabase = createAdminClient()
  console.log(`[${SCRIPT_NAME}] read-only starting`)

  console.log(`[${SCRIPT_NAME}] Searching for Golden Barrels vendor...`)
  const { data: vendors, error: vendorError } = await supabase
    .from('invoice_vendors')
    .select('*')
    .ilike('name', '%Golden%')
    .limit(1)

  const vendorRows =
    assertScriptQuerySucceeded({
      operation: `Find vendor ilike "%Golden%"`,
      data: vendors,
      error: vendorError,
    }) ?? []

  const vendor = vendorRows[0] as { id?: unknown; name?: unknown } | undefined
  if (!vendor || typeof vendor.id !== 'string') {
    throw new Error(`[${SCRIPT_NAME}] No vendor found matching "Golden"`)
  }

  console.log(`[${SCRIPT_NAME}] Found vendor: ${String(vendor.name ?? '')} (${vendor.id})`)

  console.log(`\n[${SCRIPT_NAME}] Fetching projects...`)
  const { data: projects, error: projectError } = await supabase
    .from('oj_projects')
    .select('*')
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false })

  const projectRows =
    assertScriptQuerySucceeded({
      operation: `Load projects for vendor ${vendor.id}`,
      data: projects,
      error: projectError,
    }) ?? []

  if (projectRows.length === 0) {
    console.log(`[${SCRIPT_NAME}] Found 0 projects.`)
    return
  }

  console.log(`[${SCRIPT_NAME}] Found ${projectRows.length} projects.`)
  const first = projectRows[0] as Record<string, unknown>
  console.log(`[${SCRIPT_NAME}] Project keys:`, Object.keys(first))

  for (const project of projectRows) {
    const row = project as Record<string, unknown>
    console.log(`- [${String(row.status ?? '')}] ${String(row.project_name ?? '')} (id=${String(row.id ?? '')})`)
    console.log(
      `  retainer=${String(row.is_retainer ?? '')} period=${String(row.retainer_period_yyyymm ?? '')} budget_hours=${String(row.budget_hours ?? '')} budget_ex_vat=${String(row.budget_ex_vat ?? '')}`
    )
  }

  console.log(`\n[${SCRIPT_NAME}] Fetching unbilled entries...`)
  const projectIds = projectRows.map((p) => (p as { id?: unknown }).id).filter((id): id is string => typeof id === 'string')

  if (projectIds.length === 0) {
    console.log(`[${SCRIPT_NAME}] No project ids found; skipping entry lookup.`)
    return
  }

  const { data: entries, error: entryError } = await supabase
    .from('oj_entries')
    .select('*')
    .in('project_id', projectIds)
    .eq('status', 'unbilled')
    .order('entry_date', { ascending: true })

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `Load unbilled entries`,
      data: entries,
      error: entryError,
    }) ?? []

  if (entryRows.length > 0) {
    const firstDate = (entryRows[0] as { entry_date?: unknown }).entry_date
    const lastDate = (entryRows[entryRows.length - 1] as { entry_date?: unknown }).entry_date
    console.log(`[${SCRIPT_NAME}] Entry date range: ${String(firstDate ?? '')} to ${String(lastDate ?? '')}`)
  }

  const totalMinutes = entryRows.reduce((acc, entry) => {
    const minutes = Number((entry as { duration_minutes_rounded?: unknown }).duration_minutes_rounded ?? 0)
    return acc + (Number.isFinite(minutes) ? minutes : 0)
  }, 0)

  const totalHours = totalMinutes / 60
  const totalSpend = entryRows.reduce((acc, entry) => {
    const row = entry as {
      entry_type?: unknown
      duration_minutes_rounded?: unknown
      hourly_rate_ex_vat_snapshot?: unknown
    }
    if (row.entry_type !== 'time') {
      return acc
    }
    const minutes = Number(row.duration_minutes_rounded ?? 0)
    const rate = Number(row.hourly_rate_ex_vat_snapshot ?? 0)
    if (!Number.isFinite(minutes) || !Number.isFinite(rate)) {
      return acc
    }
    return acc + (minutes / 60) * rate
  }, 0)

  console.log(`[${SCRIPT_NAME}] Found ${entryRows.length} unbilled entries.`)
  console.log(`[${SCRIPT_NAME}] Total unbilled work: ${totalHours.toFixed(2)} hours`)
  console.log(`[${SCRIPT_NAME}] Approx unbilled value: GBP ${totalSpend.toFixed(2)}`)

  console.log(`\n[${SCRIPT_NAME}] Fetching vendor billing settings...`)
  const { data: settings, error: settingsError } = await supabase
    .from('oj_vendor_billing_settings')
    .select('*')
    .eq('vendor_id', vendor.id)

  const settingsRows =
    assertScriptQuerySucceeded({
      operation: `Load vendor billing settings`,
      data: settings,
      error: settingsError,
    }) ?? []

  console.log(`[${SCRIPT_NAME}] Billing settings:`, settingsRows)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
