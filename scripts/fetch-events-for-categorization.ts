#!/usr/bin/env tsx
/**
 * Fetch event categories and a capped list of upcoming events for offline categorization (read-only).
 *
 * Safety:
 * - Strictly read-only; blocks `--confirm`.
 * - Requires an explicit cap via `--limit` (bounded by a hard cap) to avoid accidental large dumps.
 * - Fails closed on env/query errors via `process.exitCode = 1`.
 *
 * Usage:
 *   tsx scripts/fetch-events-for-categorization.ts --limit 200
 *   tsx scripts/fetch-events-for-categorization.ts --limit 200 --from-date 2026-01-01
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'fetch-events-for-categorization'
const HARD_CAP = 1000

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

function assertIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid ${label}: ${value} (expected YYYY-MM-DD)`)
  }
  return value
}

async function main() {
  const argv = process.argv.slice(2)
  assertReadOnly(argv)

  const limit = parsePositiveInt(readOptionalFlagValue(argv, '--limit'))
  if (!limit) {
    throw new Error(`[${SCRIPT_NAME}] Missing required --limit <n> (hard cap ${HARD_CAP})`)
  }
  if (limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }

  const fromDateRaw = readOptionalFlagValue(argv, '--from-date')
  const today = new Date().toISOString().split('T')[0]
  const fromDate = fromDateRaw ? assertIsoDate(fromDateRaw, '--from-date') : today

  const supabase = createAdminClient()

  const { data: categories, error: catError } = await supabase
    .from('event_categories')
    .select('id, name, slug, description')
    .order('sort_order', { ascending: true })

  if (catError) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching categories: ${catError.message || 'unknown error'}`)
  }

  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, name, short_description, long_description, category_id, date, event_status')
    .gte('date', fromDate)
    .neq('event_status', 'cancelled')
    .order('date', { ascending: true })
    .limit(limit)

  if (eventError) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching events: ${eventError.message || 'unknown error'}`)
  }

  console.log(JSON.stringify({ categories, events }, null, 2))
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})

