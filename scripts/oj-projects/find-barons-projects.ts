#!/usr/bin/env tsx
/**
 * OJ vendor project listing (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-find-barons-projects'
const BARONS_VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3'

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

  const { data, error } = await supabase.from('oj_projects').select('*').eq('vendor_id', BARONS_VENDOR_ID)

  const projects = assertScriptQuerySucceeded({
    operation: `Load Barons projects`,
    data,
    error,
  })

  console.log(`[${SCRIPT_NAME}] Found ${projects?.length ?? 0} project(s) for vendor ${BARONS_VENDOR_ID}`)
  console.log(projects)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
