#!/usr/bin/env tsx
/**
 * Employee status diagnostics (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed: any query error or prohibited status exits non-zero.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'check-employee-status'

const EXPECTED_STATUSES = new Set(['Active', 'Inactive', 'Suspended', 'Prospective'])

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
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }

  const admin = createAdminClient()
  console.log(`[${SCRIPT_NAME}] read-only starting`)

  const { data, error } = await admin.from('employees').select('status')

  const rows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load employees.status`,
      error,
      data: (data ?? null) as Array<{ status?: unknown }> | null,
    }) ?? []

  const uniqueStatuses = new Set<string>()

  for (const row of rows) {
    const status = row?.status
    if (typeof status === 'string' && status.trim().length > 0) {
      uniqueStatuses.add(status.trim())
    }
  }

  const sorted = Array.from(uniqueStatuses).sort((a, b) => a.localeCompare(b))
  console.log(`[${SCRIPT_NAME}] Unique statuses: ${JSON.stringify(sorted)}`)

  const invalid = sorted.filter((status) => !EXPECTED_STATUSES.has(status))
  if (invalid.length > 0) {
    throw new Error(`[${SCRIPT_NAME}] Prohibited employee statuses found: ${invalid.join(', ')}`)
  }

  console.log(`[${SCRIPT_NAME}] OK: all employee statuses are valid.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

