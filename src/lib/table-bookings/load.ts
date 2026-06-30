import { createAdminClient } from '@/lib/supabase/admin'

export type PacingSettings = {
  busyThresholdCovers: number
  fillingThresholdCovers: number
  windowMinutes: number
}

export type PublicPacingSettings = {
  busy_threshold_covers: number
  filling_threshold_covers: number
  window_minutes: number
}

export type BookingLoadEntry = {
  time: string
  covers: number
}

type SupabaseClient = ReturnType<typeof createAdminClient>

type BookingLoadRow = {
  booking_time: string | null
  party_size: number | string | null
  committed_party_size: number | string | null
  status: string | null
  left_at: string | null
  hold_expires_at: string | null
  payment_status: string | null
}

const DEFAULT_PACING_SETTINGS: PacingSettings = {
  busyThresholdCovers: 30,
  fillingThresholdCovers: 20,
  windowMinutes: 60,
}

const PACING_SETTING_KEYS = {
  busyThresholdCovers: 'pacing_busy_threshold_covers',
  fillingThresholdCovers: 'pacing_filling_threshold_covers',
  windowMinutes: 'pacing_window_minutes',
} as const

const PACING_SETTING_DESCRIPTIONS: Record<keyof PacingSettings, string> = {
  busyThresholdCovers: 'Table-booking smoothing: covers at or above this count are shown as busy.',
  fillingThresholdCovers: 'Table-booking smoothing: covers at or above this count are shown as filling up.',
  windowMinutes: 'Table-booking smoothing: rolling arrival window in minutes.',
}

export function toPublicPacingSettings(settings: PacingSettings): PublicPacingSettings {
  return {
    busy_threshold_covers: settings.busyThresholdCovers,
    filling_threshold_covers: settings.fillingThresholdCovers,
    window_minutes: settings.windowMinutes,
  }
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^\d{2}:\d{2}$/.test(value)) return value
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value.slice(0, 5)
  return null
}

function coerceInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return coerceInteger(source.value ?? source.minutes)
  }

  return null
}

function withValidInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = coerceInteger(value)
  if (parsed === null || parsed < min || parsed > max) {
    return Math.min(Math.max(fallback, min), max)
  }
  return parsed
}

export function normalizePacingSettings(input: Partial<Record<keyof PacingSettings, unknown>>): PacingSettings {
  const busyThresholdCovers = withValidInteger(
    input.busyThresholdCovers,
    DEFAULT_PACING_SETTINGS.busyThresholdCovers,
    2,
    200
  )
  const fillingThresholdCovers = withValidInteger(
    input.fillingThresholdCovers,
    DEFAULT_PACING_SETTINGS.fillingThresholdCovers,
    1,
    busyThresholdCovers - 1
  )
  const windowMinutes = withValidInteger(
    input.windowMinutes,
    DEFAULT_PACING_SETTINGS.windowMinutes,
    30,
    180
  )

  return {
    busyThresholdCovers,
    fillingThresholdCovers,
    windowMinutes,
  }
}

export function validatePacingSettings(input: Partial<Record<keyof PacingSettings, unknown>>):
  | { ok: true; settings: PacingSettings }
  | { ok: false; error: string } {
  const busyThresholdCovers = coerceInteger(input.busyThresholdCovers)
  const fillingThresholdCovers = coerceInteger(input.fillingThresholdCovers)
  const windowMinutes = coerceInteger(input.windowMinutes)

  if (!busyThresholdCovers || busyThresholdCovers < 2 || busyThresholdCovers > 200) {
    return { ok: false, error: 'Busy threshold must be between 2 and 200 covers' }
  }

  if (!fillingThresholdCovers || fillingThresholdCovers < 1 || fillingThresholdCovers > 199) {
    return { ok: false, error: 'Filling threshold must be between 1 and 199 covers' }
  }

  if (fillingThresholdCovers >= busyThresholdCovers) {
    return { ok: false, error: 'Filling threshold must be lower than busy threshold' }
  }

  if (!windowMinutes || windowMinutes < 30 || windowMinutes > 180 || windowMinutes % 2 !== 0) {
    return { ok: false, error: 'Window must be an even number between 30 and 180 minutes' }
  }

  return {
    ok: true,
    settings: {
      busyThresholdCovers,
      fillingThresholdCovers,
      windowMinutes,
    },
  }
}

export async function getPacingSettings(supabase: SupabaseClient = createAdminClient()): Promise<PacingSettings> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', Object.values(PACING_SETTING_KEYS))

  if (error) {
    console.warn('[table-bookings/load] Failed to load pacing settings; using defaults')
    return DEFAULT_PACING_SETTINGS
  }

  const mapped: Partial<Record<keyof PacingSettings, unknown>> = {}
  for (const row of data || []) {
    if (row.key === PACING_SETTING_KEYS.busyThresholdCovers) {
      mapped.busyThresholdCovers = row.value
    } else if (row.key === PACING_SETTING_KEYS.fillingThresholdCovers) {
      mapped.fillingThresholdCovers = row.value
    } else if (row.key === PACING_SETTING_KEYS.windowMinutes) {
      mapped.windowMinutes = row.value
    }
  }

  return normalizePacingSettings(mapped)
}

export async function savePacingSettings(
  supabase: SupabaseClient,
  settings: PacingSettings
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = [
    {
      key: PACING_SETTING_KEYS.busyThresholdCovers,
      value: { value: settings.busyThresholdCovers },
      description: PACING_SETTING_DESCRIPTIONS.busyThresholdCovers,
      updated_at: new Date().toISOString(),
    },
    {
      key: PACING_SETTING_KEYS.fillingThresholdCovers,
      value: { value: settings.fillingThresholdCovers },
      description: PACING_SETTING_DESCRIPTIONS.fillingThresholdCovers,
      updated_at: new Date().toISOString(),
    },
    {
      key: PACING_SETTING_KEYS.windowMinutes,
      value: { value: settings.windowMinutes },
      description: PACING_SETTING_DESCRIPTIONS.windowMinutes,
      updated_at: new Date().toISOString(),
    },
  ]

  const { error } = await supabase
    .from('system_settings')
    .upsert(rows, { onConflict: 'key' })

  if (error) {
    return { ok: false, error: 'Failed to save pacing settings' }
  }

  return { ok: true }
}

function shouldCountBooking(row: BookingLoadRow, now: Date): boolean {
  if (row.status === 'cancelled' || row.status === 'no_show') {
    return false
  }

  if (row.left_at) {
    return false
  }

  if (
    (row.status === 'pending_payment' || row.status === 'pending_card_capture') &&
    row.hold_expires_at &&
    row.payment_status !== 'completed'
  ) {
    const expiresAt = new Date(row.hold_expires_at)
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt < now) {
      return false
    }
  }

  return true
}

export function buildBookingLoad(rows: BookingLoadRow[], now: Date = new Date()): BookingLoadEntry[] {
  const coversByTime = new Map<string, number>()

  for (const row of rows) {
    if (!shouldCountBooking(row, now)) {
      continue
    }

    const time = normalizeTime(row.booking_time)
    if (!time) {
      continue
    }

    const committedPartySize = coerceInteger(row.committed_party_size)
    const partySize = coerceInteger(row.party_size)
    const covers = committedPartySize ?? partySize ?? 0
    if (covers <= 0) {
      continue
    }

    coversByTime.set(time, (coversByTime.get(time) || 0) + covers)
  }

  return Array.from(coversByTime.entries())
    .map(([time, covers]) => ({ time, covers }))
    .sort((a, b) => a.time.localeCompare(b.time))
}

export async function getBookingLoadForDate(
  date: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<BookingLoadEntry[]> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select('booking_time, party_size, committed_party_size, status, left_at, hold_expires_at, payment_status')
    .eq('booking_date', date)
    .order('booking_time', { ascending: true })

  if (error) {
    throw new Error('Failed to load table booking counts')
  }

  return buildBookingLoad((data || []) as BookingLoadRow[])
}
