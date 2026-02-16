#!/usr/bin/env tsx
/**
 * Service slot generation diagnostics (read-only).
 *
 * Safety note:
 * - This script MUST be read-only. It no longer calls `auto_generate_weekly_slots`,
 *   because that RPC mutates production data and cannot be safely capped.
 * - It fails closed on any query errors and treats missing slots as a failure.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'test-slot-generation'
const HARD_CAP_WEEKS = 12

function getArgValue(flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 2; i < process.argv.length; i += 1) {
    const entry = process.argv[i]
    if (entry === flag) {
      const next = process.argv[i + 1]
      return typeof next === 'string' && next.length > 0 ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      const value = entry.slice(withEqualsPrefix.length)
      return value.length > 0 ? value : null
    }
  }
  return null
}

function parseWeeks(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid positive integer for --weeks: ${value}`)
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for --weeks: ${value}`)
  }
  if (parsed > HARD_CAP_WEEKS) {
    throw new Error(`--weeks exceeds hard cap ${HARD_CAP_WEEKS}`)
  }
  return parsed
}

async function run() {
  if (process.argv.includes('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  console.log('Service slot diagnostics (read-only)\n')

  const weeks = parseWeeks(getArgValue('--weeks') ?? process.env.TEST_SLOT_WEEKS ?? null, 4)

  const supabase = createAdminClient()

  // Find the next Sunday (UTC) and check N weeks.
  const nextSunday = new Date()
  while (nextSunday.getUTCDay() !== 0) {
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 1)
  }

  console.log(`Weeks: ${weeks}`)
  console.log('\nChecking Sunday lunch slots:')

  const missing: string[] = []

  for (let i = 0; i < weeks; i += 1) {
    const checkDate = new Date(nextSunday)
    checkDate.setUTCDate(checkDate.getUTCDate() + i * 7)
    const dateStr = checkDate.toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('service_slots')
      .select('id, starts_at, ends_at, capacity')
      .eq('service_date', dateStr)
      .eq('booking_type', 'sunday_lunch')
      .order('starts_at')

    const slots =
      (assertScriptQuerySucceeded({
        operation: `Load service_slots for ${dateStr}`,
        error,
        data: data as Array<{ id: string }> | null,
        allowMissing: true,
      }) ?? []) as Array<{ id: string }>

    const slotCount = slots.length
    if (slotCount === 0) {
      missing.push(dateStr)
      continue
    }

    console.log(`- ${dateStr}: ${slotCount} slot(s)`)
  }

  if (missing.length > 0) {
    throw new Error(`Missing sunday_lunch service slots for: ${missing.join(', ')}`)
  }

  console.log('\n✅ Read-only slot diagnostics completed.')
}

run().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, error)
  process.exitCode = 1
})
