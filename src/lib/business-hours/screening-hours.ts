import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadPublishedVersions } from './effective'
import { resolveForDates } from './resolve'
import { resolveKitchenWindows } from './kitchen-windows'
import { getTodayIsoDate, isValidIsoDate, parseLondonDateTimeLocalToIso, shiftIsoDate } from '@/lib/dateUtils'
import type { BusinessHours, SpecialHours } from '@/types/business-hours'
import type { ScreeningDayHours, ScreeningHoursResponse, ServiceWindow } from './screening-contract'

type OperatingRow = Pick<BusinessHours, 'opens' | 'closes' | 'is_closed' | 'is_kitchen_closed' | 'kitchen_opens' | 'kitchen_closes' | 'schedule_config'>
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/

export function validateScreeningDates(dates: string[], today = getTodayIsoDate()): string[] {
  const unique = [...new Set(dates)].sort()
  const [year, month, day] = today.split('-').map(Number)
  const targetYear = year + 1
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  const latest = `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
  if (!unique.length || unique.length > 31 || dates.length > 100 || unique.some(date => !isValidIsoDate(date) || date < today || date > latest)) {
    throw new Error('Provide 1 to 31 real dates between today and 12 months ahead')
  }
  return unique
}

function instant(date: string, time: string | null): string | null {
  return time && CLOCK.test(time) ? parseLondonDateTimeLocalToIso(`${date}T${time}`) : null
}

function windowFor(date: string, opens: string | null, closes: string | null): ServiceWindow | null {
  const startAt = instant(date, opens)
  if (!startAt || !closes || !CLOCK.test(closes)) return null
  // Closing in the small hours is the next calendar day, including DST changes.
  const overnight = closes.slice(0, 5) <= opens!.slice(0, 5)
  if (overnight && closes.slice(0, 5) > '06:00') return null
  const endAt = instant(overnight ? shiftIsoDate(date, 1)! : date, closes)
  return endAt && endAt > startAt ? { startAt, endAt } : null
}

/** Complete overrides: null kitchen bounds and empty sittings never inherit weekly values. */
export function projectScreeningDay(date: string, regular: OperatingRow, special?: OperatingRow): ScreeningDayHours {
  if (!isValidIsoDate(date)) throw new Error('Invalid operating date')
  const row = special ?? regular
  const bar = row.is_closed === true ? null : windowFor(date, row.opens, row.closes)
  if (row.is_closed !== true && !bar) throw new Error('Opening hours are unknown')
  const kitchenClosed = row.is_closed === true || row.is_kitchen_closed === true || (row.kitchen_opens === null && row.kitchen_closes === null)
  const validBounds = windowFor(date, row.kitchen_opens, row.kitchen_closes)
  const validSittings = row.schedule_config == null || (Array.isArray(row.schedule_config) && row.schedule_config.every(sitting => sitting && windowFor(date, sitting.starts_at, sitting.ends_at)))
  const kitchenState = kitchenClosed || (validBounds && validSittings) ? 'known' : 'unknown'
  const kitchen = kitchenClosed || kitchenState === 'unknown' ? [] : resolveKitchenWindows(row).flatMap(service => {
    const window = windowFor(date, service.opens, service.closes)
    if (!window || !bar) return []
    const startAt = window.startAt > bar.startAt ? window.startAt : bar.startAt
    const endAt = window.endAt < bar.endAt ? window.endAt : bar.endAt
    return endAt > startAt ? [{ startAt, endAt }] : []
  })
  const projection: Omit<ScreeningDayHours, 'fingerprint'> = {
    date,
    state: row.is_closed ? 'closed' : 'open',
    regularOpensAt: regular.is_closed ? null : instant(date, regular.opens),
    bar,
    kitchen,
    kitchenState,
    hasSpecialHours: Boolean(special),
  }
  return { ...projection, fingerprint: createHash('sha256').update(JSON.stringify(projection)).digest('hex') }
}

export async function getScreeningHours(dates: string[]): Promise<ScreeningHoursResponse> {
  const requested = validateScreeningDates(dates)
  const db = createAdminClient()
  const versions = await loadPublishedVersions(db)
  const regular = resolveForDates(versions, requested)
  const { data: specials, error } = await db.from('special_hours')
    .select('date, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed, schedule_config')
    .in('date', requested)
  if (error || !Array.isArray(specials)) throw new Error('Special hours could not be read')
  const overrides = new Map<string, SpecialHours>()
  for (const row of specials as SpecialHours[]) {
    if (overrides.has(row.date)) throw new Error('Duplicate special hours')
    overrides.set(row.date, row)
  }
  return {
    schemaVersion: 1,
    timezone: 'Europe/London',
    days: requested.map(date => {
      const row = regular.get(date)
      if (!row) throw new Error('Published opening hours are missing')
      return projectScreeningDay(date, row, overrides.get(date))
    }),
  }
}
