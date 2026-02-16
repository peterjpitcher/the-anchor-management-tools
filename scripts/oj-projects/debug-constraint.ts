#!/usr/bin/env tsx
/**
 * OJ constraint inspection diagnostic (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on any env/DB/RPC error (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-debug-constraint'

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

  const { data, error } = await supabase.rpc('get_constraint_def', {
    table_name: 'oj_projects',
    constraint_name: 'chk_oj_projects_retainer_period',
  })

  const result = assertScriptQuerySucceeded({
    operation: `RPC get_constraint_def(oj_projects, chk_oj_projects_retainer_period)`,
    data,
    error,
    allowMissing: true,
  })

  if (!result) {
    throw new Error(
      `[${SCRIPT_NAME}] RPC get_constraint_def returned no result. Ensure the RPC exists and returns a definition.`
    )
  }

  console.log(`[${SCRIPT_NAME}] Constraint definition:`)
  console.log(result)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

