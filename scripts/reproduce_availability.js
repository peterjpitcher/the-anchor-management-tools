#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Booking availability reproduction helper (read-only).
 *
 * Safety:
 * - Strictly read-only; blocks `--confirm`.
 * - Requires explicit `--date YYYY-MM-DD` (no hard-coded production dates).
 * - Fails closed on any env/query errors via `process.exitCode = 1`.
 *
 * Usage:
 *   node scripts/reproduce_availability.js --date 2026-12-07 --booking-type sunday_lunch --interval-minutes 30
 */

const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')
const path = require('path')

const SCRIPT_NAME = 'reproduce_availability'
const HARD_CAP_INTERVAL_MINUTES = 240

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

function parsePositiveInt(raw) {
  if (!raw) return null
  const parsed = Number.parseInt(String(raw), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function requireEnv(name, value) {
  if (!value || String(value).trim().length === 0) {
    throw new Error(`[${SCRIPT_NAME}] Missing required environment variable: ${name}`)
  }
  return String(value).trim()
}

function assertReadOnly(argv) {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }
}

function assertIsoDate(value, label) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(value))) {
    throw new Error(`[${SCRIPT_NAME}] Invalid ${label}: ${value} (expected YYYY-MM-DD)`)
  }
  return String(value)
}

function parseTimeToMinutes(time) {
  const raw = String(time ?? '').trim()
  const parts = raw.split(':')
  if (parts.length < 2) {
    return null
  }

  const hours = Number.parseInt(parts[0], 10)
  const minutes = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return hours * 60 + minutes
}

function formatMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.floor(totalMinutes))
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

function generateTimeSlots(openTime, closeTime, intervalMinutes) {
  const start = parseTimeToMinutes(openTime)
  const end = parseTimeToMinutes(closeTime)
  if (start === null || end === null) {
    throw new Error(`[${SCRIPT_NAME}] Invalid open/close time(s): ${openTime} -> ${closeTime}`)
  }
  if (end <= start) {
    throw new Error(`[${SCRIPT_NAME}] Close time must be after open time: ${openTime} -> ${closeTime}`)
  }

  const interval = intervalMinutes
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error(`[${SCRIPT_NAME}] Invalid intervalMinutes: ${intervalMinutes}`)
  }

  const slots = []
  for (let t = start; t < end; t += interval) {
    slots.push(formatMinutes(t))
  }
  return slots
}

function resolveEffectiveHours(activeHours, bookingType) {
  let effectiveOpen = activeHours?.kitchen_opens ?? null
  let effectiveClose = activeHours?.kitchen_closes ?? null

  const config = activeHours?.schedule_config
  if (!Array.isArray(config) || config.length === 0) {
    return { effectiveOpen, effectiveClose, appliedScheduleConfig: false }
  }

  const candidates = config.filter((c) => {
    if (!bookingType) return true
    return c && typeof c.booking_type === 'string' && c.booking_type === bookingType
  })

  const starts = candidates.map((c) => c?.starts_at).filter((v) => typeof v === 'string' && v.trim().length > 0)
  const ends = candidates.map((c) => c?.ends_at).filter((v) => typeof v === 'string' && v.trim().length > 0)

  if (starts.length > 0) {
    starts.sort()
    effectiveOpen = starts[0]
  }
  if (ends.length > 0) {
    ends.sort()
    effectiveClose = ends[ends.length - 1]
  }

  return { effectiveOpen, effectiveClose, appliedScheduleConfig: true }
}

async function main() {
  const argv = process.argv.slice(2)
  assertReadOnly(argv)

  const date = assertIsoDate(readOptionalFlagValue(argv, '--date'), '--date')
  const bookingType = readOptionalFlagValue(argv, '--booking-type')
  const intervalMinutesRaw = readOptionalFlagValue(argv, '--interval-minutes')
  const intervalMinutes = parsePositiveInt(intervalMinutesRaw) ?? 30

  if (intervalMinutes > HARD_CAP_INTERVAL_MINUTES) {
    throw new Error(
      `[${SCRIPT_NAME}] --interval-minutes exceeds hard cap (max ${HARD_CAP_INTERVAL_MINUTES})`
    )
  }

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL)
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseKey) {
    throw new Error(
      `[${SCRIPT_NAME}] Missing Supabase key: set SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY`
    )
  }

  const keyKind = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon'
  console.log(`[${SCRIPT_NAME}] Mode: read-only`)
  console.log(`[${SCRIPT_NAME}] Date: ${date}`)
  console.log(`[${SCRIPT_NAME}] Booking type: ${bookingType ?? '(any)'}`)
  console.log(`[${SCRIPT_NAME}] Interval: ${intervalMinutes} minutes (hard cap ${HARD_CAP_INTERVAL_MINUTES})`)
  console.log(`[${SCRIPT_NAME}] Supabase key: ${keyKind}`)

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  // Use UTC day-of-week for stability across developer timezones.
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay()

  const { data: businessHours, error: businessError } = await supabase
    .from('business_hours')
    .select('*')
    .eq('day_of_week', dayOfWeek)
    .maybeSingle()

  if (businessError) {
    throw new Error(`[${SCRIPT_NAME}] Failed to load business_hours: ${businessError.message || 'unknown error'}`)
  }
  if (!businessHours) {
    throw new Error(`[${SCRIPT_NAME}] business_hours row missing for day_of_week=${dayOfWeek}`)
  }

  const { data: specialHours, error: specialError } = await supabase
    .from('special_hours')
    .select('*')
    .eq('date', date)
    .maybeSingle()

  if (specialError) {
    throw new Error(`[${SCRIPT_NAME}] Failed to load special_hours: ${specialError.message || 'unknown error'}`)
  }

  const activeHours = specialHours || businessHours
  const activeKind = specialHours ? 'special_hours' : 'business_hours'

  console.log(`[${SCRIPT_NAME}] Active hours source: ${activeKind}`)
  console.log(`[${SCRIPT_NAME}] Active hours id: ${activeHours?.id ?? '(missing)'}`)

  if (!activeHours || activeHours.is_closed) {
    console.log(`[${SCRIPT_NAME}] Closed: ${activeHours ? 'is_closed=true' : 'no active hours row'}`)
    return
  }

  const { effectiveOpen, effectiveClose, appliedScheduleConfig } = resolveEffectiveHours(activeHours, bookingType)

  if (!effectiveOpen || !effectiveClose) {
    throw new Error(`[${SCRIPT_NAME}] Missing effective kitchen hours (open=${effectiveOpen}, close=${effectiveClose})`)
  }

  console.log(`[${SCRIPT_NAME}] Applied schedule_config: ${appliedScheduleConfig ? 'yes' : 'no'}`)
  console.log(`[${SCRIPT_NAME}] Effective open: ${effectiveOpen} close: ${effectiveClose}`)

  const slots = generateTimeSlots(effectiveOpen, effectiveClose, intervalMinutes)
  console.log(`[${SCRIPT_NAME}] Generated slots: ${slots.length}`)
  console.log(`[${SCRIPT_NAME}] First slots: ${JSON.stringify(slots.slice(0, 10))}`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})

