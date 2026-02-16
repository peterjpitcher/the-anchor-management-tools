#!/usr/bin/env node
/**
 * Legacy JS variant of `scripts/check_hours_debug.ts` (read-only).
 *
 * Safety:
 * - Strictly read-only; blocks `--confirm`.
 * - Requires explicit `--special-date` if you want to query special_hours (no hard-coded dates).
 * - Fails closed on env/query errors via `process.exitCode = 1`.
 *
 * Usage:
 *   node scripts/check_hours_debug.js --day-of-week 0
 *   node scripts/check_hours_debug.js --day-of-week 0 --special-date 2026-12-07
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'node:path'

const SCRIPT_NAME = 'check_hours_debug_js'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function readOptionalFlagValue(argv, flag) {
  const eq = argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${flag}=`))
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

function assertReadOnly(argv) {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }
}

function resolveDayOfWeek(argv) {
  const raw = readOptionalFlagValue(argv, '--day-of-week')
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 6) {
    throw new Error(`[${SCRIPT_NAME}] Invalid --day-of-week: ${raw} (expected 0-6)`)
  }
  return parsed
}

function assertIsoDate(value, label) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(value))) {
    throw new Error(`[${SCRIPT_NAME}] Invalid ${label}: ${value} (expected YYYY-MM-DD)`)
  }
  return String(value)
}

async function main() {
  const argv = process.argv.slice(2)
  assertReadOnly(argv)

  const dayOfWeek = resolveDayOfWeek(argv)
  const specialDateRaw = readOptionalFlagValue(argv, '--special-date')
  const specialDate = specialDateRaw ? assertIsoDate(specialDateRaw, '--special-date') : null

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase URL or Key (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY/ANON).')
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`Checking business hours for day_of_week=${dayOfWeek}...`)

  const { data: businessHours, error: hoursError } = await supabase
    .from('business_hours')
    .select('*')
    .eq('day_of_week', dayOfWeek)

  if (hoursError) {
    throw new Error(`Error fetching business hours: ${hoursError.message || 'unknown error'}`)
  }

  console.log('Business hours:', JSON.stringify(businessHours || [], null, 2))

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
    throw new Error(`Error fetching special hours: ${specialError.message || 'unknown error'}`)
  }

  console.log('Special hours:', JSON.stringify(specialHours || [], null, 2))
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})
