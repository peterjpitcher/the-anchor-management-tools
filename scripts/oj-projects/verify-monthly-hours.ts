#!/usr/bin/env tsx
/**
 * Verify monthly hours totals for Barons Pubs against expected targets (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors and on verification mismatches (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-verify-monthly-hours'

const TARGETS: Record<string, number> = {
  '2025-09': 31.5,
  '2025-10': 37,
  '2025-11': 1.5,
  '2025-12': 35,
  '2026-01': 30,
}

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

  const { data: entries, error: entriesError } = await supabase
    .from('oj_entries')
    .select('entry_date, duration_minutes_rounded')
    .eq('vendor_id', vendorRow.id)
    .eq('entry_type', 'time')

  const entryRows =
    assertScriptQuerySucceeded({
      operation: `Load Barons time entries`,
      data: entries,
      error: entriesError,
    }) ?? []

  const totals: Record<string, number> = {}
  for (const entry of entryRows) {
    const date = entry.entry_date as unknown
    if (typeof date !== 'string' || date.length < 7) {
      continue
    }
    const month = date.slice(0, 7)
    const minutes = Number((entry as { duration_minutes_rounded?: unknown }).duration_minutes_rounded ?? 0)
    const hours = Number.isFinite(minutes) ? minutes / 60 : 0
    totals[month] = (totals[month] || 0) + hours
  }

  console.log('\nMonthly Hours Verification for Barons Pubs:')
  console.log('Month\tActual\tTarget\tMatch')
  console.log('----------------------------------------')

  const mismatches: string[] = []
  for (const [month, expected] of Object.entries(TARGETS).sort()) {
    const actual = totals[month] || 0
    const diff = actual - expected
    const match = Math.abs(diff) < 0.01 // float tolerance
    if (!match) {
      mismatches.push(`${month} actual=${actual} expected=${expected} diff=${diff}`)
    }
    console.log(`${month}\t${actual}\t${expected}\t${match ? 'OK' : 'FAIL'}`)
  }

  console.log('\nOther Months found (not in target set):')
  for (const [month, total] of Object.entries(totals).sort()) {
    if (!Object.hasOwn(TARGETS, month)) {
      console.log(`${month}\t${total}`)
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `[${SCRIPT_NAME}] Verification failed for ${mismatches.length} month(s): ${mismatches.slice(0, 3).join(' | ')}`
    )
  }

  console.log(`[${SCRIPT_NAME}] Verification OK`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
