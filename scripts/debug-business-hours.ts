#!/usr/bin/env tsx
/**
 * Debug a `business_hours` row for a given day-of-week (read-only).
 *
 * Safety:
 * - Strictly read-only; blocks `--confirm`.
 * - Fails closed on env/query errors via `process.exitCode = 1`.
 *
 * Usage:
 *   tsx scripts/debug-business-hours.ts --day-of-week 0
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'debug-business-hours'

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

function assertReadOnly(argv: string[] = process.argv.slice(2)) {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }
}

function resolveDayOfWeek(argv: string[]): number {
  const raw = readOptionalFlagValue(argv, '--day-of-week')
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 6) {
    throw new Error(`[${SCRIPT_NAME}] Invalid --day-of-week: ${raw} (expected 0-6)`)
  }
  return parsed
}

async function main() {
  const argv = process.argv.slice(2)
  assertReadOnly(argv)

  const dayOfWeek = resolveDayOfWeek(argv)
  const supabase = createAdminClient()

  console.log(`--- Debugging Business Hours (day_of_week=${dayOfWeek}) ---`)

  const { data: hours, error } = await supabase
    .from('business_hours')
    .select('*')
    .eq('day_of_week', dayOfWeek)
    .maybeSingle()

  if (error) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching hours: ${error.message || 'unknown error'}`)
  }
  if (!hours) {
    throw new Error(`[${SCRIPT_NAME}] business_hours row not found for day_of_week=${dayOfWeek}`)
  }

  console.log('Current DB record:')
  console.log(JSON.stringify(hours, null, 2))

  const config = (hours as any).schedule_config
  console.log('Schedule config:', JSON.stringify(config, null, 2))

  if (Array.isArray(config)) {
    const lunch = config.find((c: any) => c.booking_type === 'sunday_lunch')
    console.log('Found sunday_lunch config:', lunch ?? null)
  } else {
    console.log('Schedule config is not an array')
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})

