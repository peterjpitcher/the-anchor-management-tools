#!/usr/bin/env tsx
/**
 * List Barons Pubs time entries for January 2026 (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-list-january'

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

  const start = '2026-01-01'
  const end = '2026-01-31'

  const { data: entries, error: entriesError } = await supabase
    .from('oj_entries')
    .select(
      `
        entry_date,
        duration_minutes_rounded,
        description,
        project:oj_projects(project_name)
      `
    )
    .eq('vendor_id', vendorRow.id)
    .eq('entry_type', 'time')
    .gte('entry_date', start)
    .lte('entry_date', end)
    .order('entry_date', { ascending: true })

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `Load January 2026 entries`,
      data: entries,
      error: entriesError,
    }) ?? []

  let total = 0
  for (const entry of entryRows) {
    const minutes = Number((entry as { duration_minutes_rounded?: unknown }).duration_minutes_rounded ?? 0)
    const hours = Number.isFinite(minutes) ? minutes / 60 : 0
    total += hours
  }

  console.log(`\n[${SCRIPT_NAME}] January 2026 entries: ${entryRows.length}`)
  console.log(`[${SCRIPT_NAME}] Total: ${total} hours`)

  console.log('\nDetailed list (tab-separated):')
  for (const entry of entryRows) {
    const minutes = Number((entry as { duration_minutes_rounded?: unknown }).duration_minutes_rounded ?? 0)
    const hours = Number.isFinite(minutes) ? minutes / 60 : 0
    console.log(`${(entry as { entry_date?: unknown }).entry_date}\t${hours}\t${(entry as { description?: unknown }).description}`)
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
