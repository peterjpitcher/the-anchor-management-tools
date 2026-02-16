#!/usr/bin/env tsx
/**
 * Debug snapshot fields for Barons entries (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-debug-snapshots'

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

  const { data: vendor, error: vendorError } = await supabase
    .from('invoice_vendors')
    .select('id')
    .eq('name', 'Barons Pubs')
    .maybeSingle()

  const vendorRow = assertScriptQuerySucceeded({
    operation: `Load vendor "Barons Pubs"`,
    data: vendor,
    error: vendorError,
    allowMissing: true,
  })
  if (!vendorRow) {
    throw new Error(`[${SCRIPT_NAME}] Vendor "Barons Pubs" not found`)
  }

  console.log(`[${SCRIPT_NAME}] Checking entries with 0 or null rate...`)
  const { data: entries, error: entriesError } = await supabase
    .from('oj_entries')
    .select(`id, entry_date, description, hourly_rate_ex_vat_snapshot, duration_minutes_rounded, project:oj_projects(project_name)`)
    .eq('vendor_id', vendorRow.id)
    .eq('entry_type', 'time')
    .order('entry_date', { ascending: false })

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `Load time entries`,
      data: entries,
      error: entriesError,
    }) ?? []

  let zeroCount = 0
  for (const entry of entryRows) {
    const rate = (entry as { hourly_rate_ex_vat_snapshot?: unknown }).hourly_rate_ex_vat_snapshot
    if (rate === 0 || rate === null) {
      const date = (entry as { entry_date?: unknown }).entry_date
      const description = String((entry as { description?: unknown }).description ?? '')
      const projectName = (entry as { project?: { project_name?: unknown } }).project?.project_name
      console.log(`[ZERO RATE] ${date} - ${description.substring(0, 40)}... (rate=${String(rate)}, project=${String(projectName ?? '')})`)
      zeroCount += 1
    }
  }

  console.log(`\n[${SCRIPT_NAME}] Found ${zeroCount} entries with 0/null rate out of ${entryRows.length} total.`)

  const { data: settings, error: settingsError } = await supabase
    .from('oj_vendor_billing_settings')
    .select('*')
    .eq('vendor_id', vendorRow.id)
    .maybeSingle()

  const settingsRow = assertScriptQuerySucceeded({
    operation: `Load vendor billing settings`,
    data: settings,
    error: settingsError,
    allowMissing: true,
  })

  console.log(`[${SCRIPT_NAME}] Vendor billing settings:`, settingsRow)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
