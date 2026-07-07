import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { shouldCountBooking } from './load'

const LONDON_TIMEZONE = 'Europe/London'

// Fallback inventory when the `high_chair_inventory` setting is missing (mirrors the SQL default).
export const DEFAULT_HIGH_CHAIR_INVENTORY = 2

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

// Chair-hold rows carry the full seating span so remaining chairs are computed by
// true start/end overlap (spec A3) — not the pacing centred-window model.
export type HighChairHoldRow = {
  start_datetime: string | null
  end_datetime: string | null
  high_chair_count: number | null
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

export type KitchenAvailabilitySlot = {
  time: string
  covers: number
  remaining: number
  // Advisory per-slot high chairs left (inventory − overlapping holds). The RPC's
  // atomic grant is the real gate, so a missing/stale value can never oversell.
  high_chairs_remaining?: number
}

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

// Converts a London-local HH:MM on `dateStr` to epoch milliseconds (DST-safe).
function slotEpochMs(dateStr: string, minutes: number): number | null {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  const utc = fromZonedTime(`${dateStr}T${hh}:${mm}:00`, LONDON_TIMEZONE)
  const ms = utc.getTime()
  return Number.isNaN(ms) ? null : ms
}

function coerceChairCount(value: number | null | undefined): number {
  const n = coerceInt(value)
  return n !== null && n > 0 ? n : 0
}

/**
 * Enrich each availability slot with `high_chairs_remaining` = max(0, inventory − held),
 * where `held` sums the GRANTED chair counts of any booking whose seating span overlaps
 * the slot window [slotStart, slotStart+stepMinutes). Eligibility mirrors `shouldCountBooking`
 * (spec A5) so the read-out agrees with the SQL `count_high_chairs_in_window` primitive.
 *
 * This figure is advisory only — the RPC's atomic grant is the authoritative gate.
 */
export function enrichSlotsWithHighChairsRemaining(
  slots: KitchenAvailabilitySlot[],
  holds: HighChairHoldRow[],
  inventory: number,
  dateStr: string,
  stepMinutes: number,
  now: Date = new Date()
): KitchenAvailabilitySlot[] {
  const safeInventory = Math.max(0, Number.isFinite(inventory) ? Math.trunc(inventory) : DEFAULT_HIGH_CHAIR_INVENTORY)

  // Pre-parse eligible chair holds once (span + granted count) to avoid re-work per slot.
  const parsedHolds = holds
    .map((row) => {
      const chairs = coerceChairCount(row.high_chair_count)
      if (chairs <= 0) return null
      // shouldCountBooking takes the load.ts BookingLoadRow shape; our fields are a superset.
      if (!shouldCountBooking(row as never, now)) return null
      const startMs = row.start_datetime ? Date.parse(row.start_datetime) : NaN
      const endMs = row.end_datetime ? Date.parse(row.end_datetime) : NaN
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
      return { startMs, endMs, chairs }
    })
    .filter((h): h is { startMs: number; endMs: number; chairs: number } => h !== null)

  return slots.map((slot) => {
    const [h, m] = slot.time.split(':').map((part) => Number.parseInt(part, 10))
    if (Number.isNaN(h) || Number.isNaN(m)) {
      return { ...slot, high_chairs_remaining: safeInventory }
    }
    const slotStartMs = slotEpochMs(dateStr, h * 60 + m)
    if (slotStartMs === null) {
      return { ...slot, high_chairs_remaining: safeInventory }
    }
    const slotEndMs = slotStartMs + stepMinutes * 60 * 1000
    let used = 0
    for (const hold of parsedHolds) {
      if (hold.startMs < slotEndMs && hold.endMs > slotStartMs) {
        used += hold.chairs
      }
    }
    return { ...slot, high_chairs_remaining: Math.max(0, safeInventory - used) }
  })
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

// Total high chairs the venue owns. Stored as `{"value": N}` under key
// `high_chair_inventory`; falls back to the default when unset (mirrors the SQL COALESCE).
export async function getHighChairInventory(
  supabase: SupabaseClient = createAdminClient()
): Promise<number> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .eq('key', 'high_chair_inventory')
    .maybeSingle()
  if (error || !data) {
    return DEFAULT_HIGH_CHAIR_INVENTORY
  }
  const byKey = new Map<string, unknown>([[data.key as string, data.value]])
  return coerceInt(byKey.get('high_chair_inventory')) ?? DEFAULT_HIGH_CHAIR_INVENTORY
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
