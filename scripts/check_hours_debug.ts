#!/usr/bin/env tsx
/**
 * Business hours / special hours debug helper (read-only).
 *
 * Safety:
 * - Strictly read-only; blocks `--confirm`.
 * - Requires explicit `--special-date` if you want to query special_hours (no hard-coded dates).
 * - Fails closed on env/query errors via `process.exitCode = 1`.
 *
 * Usage:
 *   tsx scripts/check_hours_debug.ts --day-of-week 0
 *   tsx scripts/check_hours_debug.ts --day-of-week 0 --special-date 2026-12-07
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'check_hours_debug'

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

function assertIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid ${label}: ${value} (expected YYYY-MM-DD)`)
  }
  return value
}

async function main() {
  const argv = process.argv.slice(2)
  assertReadOnly(argv)

  const dayOfWeek = resolveDayOfWeek(argv)
  const specialDateRaw = readOptionalFlagValue(argv, '--special-date')
  const specialDate = specialDateRaw ? assertIsoDate(specialDateRaw, '--special-date') : null

  const supabase = createAdminClient()

  console.log(`Checking business hours for day_of_week=${dayOfWeek}...`)
  const { data: businessHours, error: hoursError } = await supabase
    .from('business_hours')
    .select('*')
    .eq('day_of_week', dayOfWeek)

  if (hoursError) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching business hours: ${hoursError.message || 'unknown error'}`)
  }

  console.log('Business hours:', JSON.stringify(businessHours ?? [], null, 2))

  if (!specialDate) {
    console.log('No --special-date provided; skipping special_hours lookup.')
    return
  }

  console.log(`Checking special hours for date=${specialDate}...`)
  const { data: specialHours, error: specialError } = await supabase
    .from('special_hours')
    .select('*')
    .eq('date', specialDate)

  if (specialError) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching special hours: ${specialError.message || 'unknown error'}`)
  }

  console.log('Special hours:', JSON.stringify(specialHours ?? [], null, 2))
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})

