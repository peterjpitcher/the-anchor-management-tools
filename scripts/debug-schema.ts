#!/usr/bin/env tsx
/**
 * Schema debugging helpers (read-only).
 *
 * Current check: samples recent `bookings.booking_source` values and prints unique results.
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Requires an explicit cap via `--limit` (defaults to 1000, hard cap 10000).
 * - Fails closed on env/query errors.
 *
 * Usage:
 *   scripts/debug-schema.ts [--limit 1000]
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'debug-schema'
const DEFAULT_LIMIT = 1000
const HARD_CAP_LIMIT = 10000

type Args = {
  confirm: boolean
  limit: number
}

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=').slice(1).join('=') || null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx === -1) return null
  const value = argv[idx + 1]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')

  const limitRaw = readOptionalFlagValue(rest, '--limit')
  const limit = parsePositiveInt(limitRaw) ?? DEFAULT_LIMIT
  if (limit > HARD_CAP_LIMIT) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP_LIMIT})`)
  }

  return { confirm, limit }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  if (args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }

  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] read-only starting`)
  console.log(`[${SCRIPT_NAME}] limit=${args.limit} (hard cap ${HARD_CAP_LIMIT})`)

  const { data, error } = await supabase
    .from('bookings')
    .select('booking_source, created_at')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const rows =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load booking_source sample`,
      error,
      data: (data ?? null) as Array<{ booking_source?: unknown; created_at?: unknown }> | null,
      allowMissing: true,
    }) ?? []

  const unique = new Set<string>()
  let missing = 0

  for (const row of rows) {
    const source = row?.booking_source
    if (typeof source === 'string' && source.trim().length > 0) {
      unique.add(source.trim())
      continue
    }
    missing += 1
  }

  const values = Array.from(unique).sort((a, b) => a.localeCompare(b))
  console.log(`[${SCRIPT_NAME}] Rows sampled: ${rows.length}`)
  console.log(`[${SCRIPT_NAME}] Missing/empty booking_source in sample: ${missing}`)
  console.log(`[${SCRIPT_NAME}] Unique booking_source values (sample): ${JSON.stringify(values)}`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

