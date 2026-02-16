#!/usr/bin/env tsx
/**
 * Verify Barons entries meet expected paid/unbilled cutoff rules (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors and on verification failures (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-verify-barons-entries'
const BARONS_VENDOR_ID = 'b9a6f8b9-9267-42ea-bfbf-7b122a79d9e3'
const CUTOFF = '2025-12-31'

type Args = {
  confirm: boolean
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  return { confirm: rest.includes('--confirm') }
}

function isoDateOnly(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length >= 10) return raw.slice(0, 10)
  return null
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
    .select('*')
    .eq('vendor_id', BARONS_VENDOR_ID)
    .order('entry_date', { ascending: true })

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `Load Barons entries`,
      data: entries,
      error,
    }) ?? []

  const paidEntries = entryRows.filter((entry) => (entry as { status?: unknown }).status === 'paid')
  const unbilledEntries = entryRows.filter((entry) => (entry as { status?: unknown }).status === 'unbilled')

  console.log(`[${SCRIPT_NAME}] Total entries: ${entryRows.length}`)
  console.log(`[${SCRIPT_NAME}] Paid entries: ${paidEntries.length}`)
  console.log(`[${SCRIPT_NAME}] Unbilled entries: ${unbilledEntries.length}`)

  // Date boundary checks:
  // - paid entries must be <= cutoff
  // - unbilled entries must be > cutoff
  const paidWrongDate = paidEntries.filter((entry) => {
    const date = isoDateOnly((entry as { entry_date?: unknown }).entry_date)
    return typeof date === 'string' && date > CUTOFF
  })

  const unbilledWrongDate = unbilledEntries.filter((entry) => {
    const date = isoDateOnly((entry as { entry_date?: unknown }).entry_date)
    return typeof date === 'string' && date <= CUTOFF
  })

  if (paidWrongDate.length > 0) {
    console.error(`[${SCRIPT_NAME}] Found ${paidWrongDate.length} paid entries after cutoff ${CUTOFF}`)
  }
  if (unbilledWrongDate.length > 0) {
    console.error(`[${SCRIPT_NAME}] Found ${unbilledWrongDate.length} unbilled entries on/before cutoff ${CUTOFF}`)
  }

  if (paidWrongDate.length > 0 || unbilledWrongDate.length > 0) {
    throw new Error(
      `[${SCRIPT_NAME}] Verification failed (paid-after-cutoff=${paidWrongDate.length}, unbilled-on-or-before-cutoff=${unbilledWrongDate.length})`
    )
  }

  console.log(`[${SCRIPT_NAME}] Verification OK`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
