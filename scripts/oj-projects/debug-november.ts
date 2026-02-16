#!/usr/bin/env tsx
/**
 * Debug Barons entries for November 2025 (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-debug-november'

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

  const start = '2025-11-01'
  const end = '2025-11-30'

  console.log(`[${SCRIPT_NAME}] Searching for entries between ${start} and ${end}...`)

  const { data: entries, error: entriesError } = await supabase
    .from('oj_entries')
    .select(
      `
        *,
        project:oj_projects(project_name),
        work_type:oj_work_types(name)
      `
    )
    .eq('vendor_id', vendorRow.id)
    .gte('entry_date', start)
    .lte('entry_date', end)
    .order('entry_date')

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `Load November entries`,
      data: entries,
      error: entriesError,
    }) ?? []

  if (entryRows.length === 0) {
    console.log(`[${SCRIPT_NAME}] No entries found.`)
    return
  }

  let totalHours = 0
  for (const entry of entryRows) {
    const minutes = Number((entry as { duration_minutes_rounded?: unknown }).duration_minutes_rounded ?? 0)
    const hours = Number.isFinite(minutes) ? minutes / 60 : 0
    totalHours += hours
    const date = (entry as { entry_date?: unknown }).entry_date
    const description = (entry as { description?: unknown }).description
    const projectName = (entry as { project?: { project_name?: unknown } }).project?.project_name
    console.log(`[${date}] ${hours}h - ${String(projectName ?? '').padEnd(40)} - ${description}`)
  }

  console.log(`\n[${SCRIPT_NAME}] Total hours for November 2025: ${totalHours}`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
