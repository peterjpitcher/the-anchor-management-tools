#!/usr/bin/env tsx
/**
 * OJ project "closing logic" verification (read-only).
 *
 * This script previously created/deleted test projects using the service-role key to
 * try to validate application-layer guards. That approach is unsafe and does not
 * actually verify the Next.js server action logic (because direct Supabase calls bypass it).
 *
 * Safety:
 * - Strictly read-only and blocks `--confirm`.
 * - Fails closed on env / DB read errors.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'oj-verify-closing-logic'

function isFlagPresent(flag: string): boolean {
  return process.argv.includes(flag)
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  if (isFlagPresent('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }

  const supabase = createAdminClient()

  // Minimal read-only smoke check that DB access works.
  const { error } = await supabase.from('oj_projects').select('id', { head: true, count: 'exact' })
  if (error) {
    throw new Error(`[${SCRIPT_NAME}] Failed to read oj_projects: ${error.message}`)
  }

  console.log(`[${SCRIPT_NAME}] Read-only check complete.`)
  console.log(
    `[${SCRIPT_NAME}] Note: Application-layer closing guards must be verified via integration tests or app-layer calls, not direct Supabase scripts.`
  )
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
