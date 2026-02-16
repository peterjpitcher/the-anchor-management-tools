#!/usr/bin/env tsx
/**
 * Debug entries for a specific project ("Vision Workshop") (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-debug-vision'

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

  const { data: project, error: projectError } = await supabase
    .from('oj_projects')
    .select('id, vendor_id')
    .eq('project_name', 'Vision Workshop')
    .maybeSingle()

  const projectRow = assertScriptQuerySucceeded({
    operation: `Load project "Vision Workshop"`,
    data: project,
    error: projectError,
    allowMissing: true,
  })

  if (!projectRow) {
    console.log(`[${SCRIPT_NAME}] Project "Vision Workshop" not found`)
    return
  }

  console.log(`[${SCRIPT_NAME}] Vision Workshop project id=${projectRow.id} vendor_id=${projectRow.vendor_id}`)

  const { data: entries, error: entriesError } = await supabase.from('oj_entries').select('*').eq('project_id', projectRow.id)

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `Load project entries`,
      data: entries,
      error: entriesError,
    }) ?? []

  console.log(`[${SCRIPT_NAME}] Found ${entryRows.length} entries:`)
  for (const entry of entryRows) {
    const date = (entry as { entry_date?: unknown }).entry_date
    const minutes = Number((entry as { duration_minutes_rounded?: unknown }).duration_minutes_rounded ?? 0)
    const hours = Number.isFinite(minutes) ? minutes / 60 : 0
    const description = (entry as { description?: unknown }).description
    const vendorId = (entry as { vendor_id?: unknown }).vendor_id
    console.log(`- ${date} (${hours}h): ${description} vendor=${vendorId}`)
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
