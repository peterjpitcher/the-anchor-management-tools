import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { shouldCountBooking } from './load'

export type KitchenBookingRow = {
  booking_time: string | null
  booking_purpose?: string | null
  party_size: number | null
  committed_party_size: number | null
  status: string | null
  left_at: string | null
  hold_expires_at: string | null
  payment_status: string | null
}

export type KitchenPacingSettings = {
  enabled: boolean
  windowMinutes: number
  paceCoversRegular: number
  paceCoversSunday: number
  walkInReserveRegular: number
  walkInReserveSunday: number
}

export type PublicKitchenPacingSettings = {
  enabled: boolean
  window_minutes: number
  pace_covers_regular: number
  pace_covers_sunday: number
  walk_in_reserve_regular: number
  walk_in_reserve_sunday: number
}

export type KitchenPacingOverride = { paceCovers: number | null; walkInReserve: number | null } | null

export type KitchenAvailabilitySlot = { time: string; covers: number; remaining: number }

const DEFAULTS: KitchenPacingSettings = {
  enabled: false,
  windowMinutes: 30,
  paceCoversRegular: 25,
  paceCoversSunday: 20,
  walkInReserveRegular: 6,
  walkInReserveSunday: 6,
}

const KEYS = {
  enabled: 'kitchen_pacing_enabled',
  windowMinutes: 'kitchen_pacing_window_minutes',
  paceCoversRegular: 'kitchen_pace_covers_regular',
  paceCoversSunday: 'kitchen_pace_covers_sunday',
  walkInReserveRegular: 'kitchen_walk_in_reserve_regular',
  walkInReserveSunday: 'kitchen_walk_in_reserve_sunday',
} as const

const DESCRIPTIONS: Record<keyof typeof KEYS, string> = {
  enabled: 'Kitchen pacing: master on/off for the covers-per-window cap.',
  windowMinutes: 'Kitchen pacing: rolling window length in minutes.',
  paceCoversRegular: 'Kitchen pacing: max food covers per window on a normal service.',
  paceCoversSunday: 'Kitchen pacing: max food covers per window on a Sunday.',
  walkInReserveRegular: 'Kitchen pacing: covers per window reserved for walk-ins (normal).',
  walkInReserveSunday: 'Kitchen pacing: covers per window reserved for walk-ins (Sunday).',
}

function coerceInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const n = Number.parseInt(value.trim(), 10)
    return Number.isFinite(n) ? n : null
  }
  if (value && typeof value === 'object') {
    const s = value as Record<string, unknown>
    return coerceInt(s.value ?? s.minutes)
  }
  return null
}

function coerceBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value && typeof value === 'object') return coerceBool((value as Record<string, unknown>).value)
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}

function timeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function coversOf(row: KitchenBookingRow): number {
  const committed = coerceInt(row.committed_party_size)
  const party = coerceInt(row.party_size)
  return committed ?? party ?? 0
}

function isKitchenRow(row: KitchenBookingRow, now: Date): boolean {
  if ((row.booking_purpose ?? 'food') !== 'food') return false
  // shouldCountBooking takes the load.ts BookingLoadRow shape; our fields are a superset.
  return shouldCountBooking(row as never, now)
}

export function isSundayDate(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 0
}

export function sumKitchenCoversInWindow(
  rows: KitchenBookingRow[],
  centerMinutes: number,
  windowMinutes: number,
  now: Date = new Date()
): number {
  const half = windowMinutes / 2
  let sum = 0
  for (const row of rows) {
    if (!isKitchenRow(row, now)) continue
    const t = timeToMinutes(row.booking_time)
    if (t === null) continue
    if (t >= centerMinutes - half && t < centerMinutes + half) sum += coversOf(row)
  }
  return sum
}

export function resolveKitchenCeiling(
  settings: KitchenPacingSettings,
  dateStr: string,
  override: KitchenPacingOverride
): number {
  const sunday = isSundayDate(dateStr)
  const pace = override?.paceCovers ?? (sunday ? settings.paceCoversSunday : settings.paceCoversRegular)
  const reserve = override?.walkInReserve ?? (sunday ? settings.walkInReserveSunday : settings.walkInReserveRegular)
  return Math.max(0, pace - reserve)
}

export function buildKitchenAvailabilitySlots(
  rows: KitchenBookingRow[],
  settings: KitchenPacingSettings,
  dateStr: string,
  gridStartMinutes: number,
  gridEndMinutes: number,
  stepMinutes: number,
  override: KitchenPacingOverride,
  now: Date = new Date()
): KitchenAvailabilitySlot[] {
  const ceiling = resolveKitchenCeiling(settings, dateStr, override)
  const out: KitchenAvailabilitySlot[] = []
  // Half-open window [start, end): a booking at exactly the kitchen close time is
  // outside_hours to the RPC, so never emit a slot at the end boundary.
  for (let m = gridStartMinutes; m < gridEndMinutes; m += stepMinutes) {
    const covers = sumKitchenCoversInWindow(rows, m, settings.windowMinutes, now)
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    out.push({ time: `${hh}:${mm}`, covers, remaining: Math.max(0, ceiling - covers) })
  }
  return out
}

export function toPublicKitchenPacingSettings(s: KitchenPacingSettings): PublicKitchenPacingSettings {
  return {
    enabled: s.enabled,
    window_minutes: s.windowMinutes,
    pace_covers_regular: s.paceCoversRegular,
    pace_covers_sunday: s.paceCoversSunday,
    walk_in_reserve_regular: s.walkInReserveRegular,
    walk_in_reserve_sunday: s.walkInReserveSunday,
  }
}

export function validateKitchenPacingSettings(
  input: Partial<Record<keyof KitchenPacingSettings, unknown>>
): { ok: true; settings: KitchenPacingSettings } | { ok: false; error: string } {
  const windowMinutes = coerceInt(input.windowMinutes)
  const paceCoversRegular = coerceInt(input.paceCoversRegular)
  const paceCoversSunday = coerceInt(input.paceCoversSunday)
  const walkInReserveRegular = coerceInt(input.walkInReserveRegular)
  const walkInReserveSunday = coerceInt(input.walkInReserveSunday)

  if (!windowMinutes || windowMinutes < 10 || windowMinutes > 180 || windowMinutes % 5 !== 0) {
    return { ok: false, error: 'Window must be a multiple of 5 between 10 and 180 minutes' }
  }
  for (const [label, v] of [
    ['Regular pace', paceCoversRegular],
    ['Sunday pace', paceCoversSunday],
  ] as const) {
    if (!v || v < 1 || v > 500) return { ok: false, error: `${label} must be between 1 and 500 covers` }
  }
  for (const [label, v] of [
    ['Regular walk-in reserve', walkInReserveRegular],
    ['Sunday walk-in reserve', walkInReserveSunday],
  ] as const) {
    if (v === null || v < 0 || v > 500) return { ok: false, error: `${label} must be between 0 and 500 covers` }
  }
  return {
    ok: true,
    settings: {
      enabled: coerceBool(input.enabled),
      windowMinutes,
      paceCoversRegular: paceCoversRegular!,
      paceCoversSunday: paceCoversSunday!,
      walkInReserveRegular: walkInReserveRegular!,
      walkInReserveSunday: walkInReserveSunday!,
    },
  }
}

export async function getKitchenPacingSettings(
  supabase: SupabaseClient = createAdminClient()
): Promise<KitchenPacingSettings> {
  const { data, error } = await supabase.from('system_settings').select('key, value').in('key', Object.values(KEYS))
  if (error) {
    console.warn('[kitchen-pacing] Failed to load settings; using defaults')
    return DEFAULTS
  }
  const byKey = new Map((data || []).map((r) => [r.key, r.value]))
  return {
    enabled: coerceBool(byKey.get(KEYS.enabled)),
    windowMinutes: coerceInt(byKey.get(KEYS.windowMinutes)) ?? DEFAULTS.windowMinutes,
    paceCoversRegular: coerceInt(byKey.get(KEYS.paceCoversRegular)) ?? DEFAULTS.paceCoversRegular,
    paceCoversSunday: coerceInt(byKey.get(KEYS.paceCoversSunday)) ?? DEFAULTS.paceCoversSunday,
    walkInReserveRegular: coerceInt(byKey.get(KEYS.walkInReserveRegular)) ?? DEFAULTS.walkInReserveRegular,
    walkInReserveSunday: coerceInt(byKey.get(KEYS.walkInReserveSunday)) ?? DEFAULTS.walkInReserveSunday,
  }
}

export async function saveKitchenPacingSettings(
  supabase: SupabaseClient,
  settings: KitchenPacingSettings
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString()
  const rows = [
    { key: KEYS.enabled, value: { value: settings.enabled }, description: DESCRIPTIONS.enabled, updated_at: now },
    { key: KEYS.windowMinutes, value: { value: settings.windowMinutes }, description: DESCRIPTIONS.windowMinutes, updated_at: now },
    { key: KEYS.paceCoversRegular, value: { value: settings.paceCoversRegular }, description: DESCRIPTIONS.paceCoversRegular, updated_at: now },
    { key: KEYS.paceCoversSunday, value: { value: settings.paceCoversSunday }, description: DESCRIPTIONS.paceCoversSunday, updated_at: now },
    { key: KEYS.walkInReserveRegular, value: { value: settings.walkInReserveRegular }, description: DESCRIPTIONS.walkInReserveRegular, updated_at: now },
    { key: KEYS.walkInReserveSunday, value: { value: settings.walkInReserveSunday }, description: DESCRIPTIONS.walkInReserveSunday, updated_at: now },
  ]
  const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' })
  return error ? { ok: false, error: 'Failed to save kitchen pacing settings' } : { ok: true }
}

export async function getKitchenPacingOverrideForDate(
  dateStr: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<KitchenPacingOverride> {
  const { data, error } = await supabase
    .from('special_hours')
    .select('kitchen_pace_covers, kitchen_walk_in_reserve')
    .eq('date', dateStr)
    .maybeSingle()
  if (error || !data) return null
  const pace = coerceInt(data.kitchen_pace_covers)
  const reserve = coerceInt(data.kitchen_walk_in_reserve)
  if (pace === null && reserve === null) return null
  return { paceCovers: pace, walkInReserve: reserve }
}
