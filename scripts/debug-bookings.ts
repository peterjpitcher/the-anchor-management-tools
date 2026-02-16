#!/usr/bin/env tsx
/**
 * List recent private bookings (read-only).
 *
 * Safety:
 * - Strictly read-only; blocks `--confirm`.
 * - Defaults to a small output cap; `--limit` is bounded by a hard cap.
 * - Fails closed on env/query errors via `process.exitCode = 1`.
 *
 * Usage:
 *   tsx scripts/debug-bookings.ts --limit 25
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'debug-bookings'
const DEFAULT_LIMIT = 50
const HARD_CAP = 200

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=').slice(1).join('=') || null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx === -1) {
    return null
  }

  const value = argv[idx + 1]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function assertReadOnly(argv: string[] = process.argv.slice(2)) {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }
}

function resolveLimit(argv: string[]): number {
  const raw = readOptionalFlagValue(argv, '--limit')
  const parsed = parsePositiveInt(raw)
  const limit = parsed ?? DEFAULT_LIMIT
  return Math.min(limit, HARD_CAP)
}

async function main() {
  const argv = process.argv.slice(2)
  assertReadOnly(argv)

  const limit = resolveLimit(argv)
  console.log(`[${SCRIPT_NAME}] Fetching up to ${limit} private booking(s) (hard cap ${HARD_CAP})`)

  const supabase = createAdminClient()

  const { data: bookings, error } = await supabase
    .from('private_bookings')
    .select('id, event_date, status, customer_name, event_type')
    .order('event_date', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching bookings: ${error.message || 'unknown error'}`)
  }

  const rows = bookings ?? []
  console.log(`Found ${rows.length} booking(s):`)
  rows.forEach((b) => {
    console.log(`- ${b.event_date} | ${b.status} | ${b.customer_name}`)
  })
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})

