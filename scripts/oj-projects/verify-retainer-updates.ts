#!/usr/bin/env tsx
/**
 * Verify retainer migration/update effects for Barons entries (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-verify-retainer-updates'
const VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3'

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

  const { data: entries, error } = await supabase
    .from('oj_entries')
    .select(
      `
        *,
        project:oj_projects(project_name, is_retainer)
      `
    )
    .eq('vendor_id', VENDOR_ID)

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `Load vendor entries`,
      data: entries,
      error,
    }) ?? []

  const retainerEntries = entryRows.filter((entry) => {
    const project = (entry as { project?: { is_retainer?: unknown } }).project
    return Boolean(project && project.is_retainer)
  })

  const mileageEntries = entryRows.filter((entry) => (entry as { entry_type?: unknown }).entry_type === 'mileage')
  const mileage28 = mileageEntries.filter((entry) => (entry as { miles?: unknown }).miles === 28)

  console.log(`[${SCRIPT_NAME}] Total entries: ${entryRows.length}`)
  console.log(`[${SCRIPT_NAME}] Retainer entries: ${retainerEntries.length}`)
  console.log(`[${SCRIPT_NAME}] Mileage entries: ${mileageEntries.length}`)
  console.log(`[${SCRIPT_NAME}] 28-mile entries: ${mileage28.length}`)

  const sample = mileage28[0]
  if (sample) {
    const entryDate = (sample as { entry_date?: unknown }).entry_date
    const projectName = (sample as { project?: { project_name?: unknown } }).project?.project_name
    console.log(`[${SCRIPT_NAME}] Sample 28-mile entry: date=${entryDate} project=${projectName}`)
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
