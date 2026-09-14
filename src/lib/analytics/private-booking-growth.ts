import { formatInTimeZone } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PrivateBookingGrowthRecord } from './private-booking-growth-model'

const LONDON_TIMEZONE = 'Europe/London'
const SUPABASE_PAGE_SIZE = 1000
const INCLUDED_STATUSES = new Set(['confirmed', 'completed'])
const ALLOWED_SOURCES = new Set([
  'website',
  'walk-in',
  'whatsapp',
  'phone',
  'email',
  'admin',
  'brand_site',
  'referral',
  'other',
])
const NON_PRODUCTION_MARKERS = ['api_test', 'test', 'dummy', 'demo', 'sample', 'seed', 'sandbox', 'staging']
const HISTORICAL_IMPORT_MARKER = 'Historical import approved 14 September 2026.'

type PrivateBookingGrowthRow = {
  id: string
  event_date: string
  customer_name: string
  event_type: string | null
  guest_count: number | null
  status: string | null
  source: string | null
  internal_notes: string | null
}

type PagedQueryResult<T> = {
  data: T[] | null
  error: { message: string } | null
}

export type PrivateBookingGrowthSnapshot = {
  generatedAt: string
  asOfDate: string
  firstRecordDate: string | null
  futureConfirmedCount: number
  excludedCount: number
  records: PrivateBookingGrowthRecord[]
}

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>,
): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const pageRows = data || []
    rows.push(...pageRows)
    if (pageRows.length < SUPABASE_PAGE_SIZE) break
  }

  return rows
}

function hasNonProductionMarker(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() || ''
  return NON_PRODUCTION_MARKERS.some((marker) => normalized.includes(marker))
}

function isProductionRecord(row: PrivateBookingGrowthRow): boolean {
  if (!INCLUDED_STATUSES.has(row.status || '')) return false
  const normalizedSource = row.source?.trim().toLowerCase()
  if (normalizedSource && !ALLOWED_SOURCES.has(normalizedSource)) return false
  return !hasNonProductionMarker(row.customer_name) && !hasNonProductionMarker(row.event_type)
}

export async function loadPrivateBookingGrowthSnapshot(): Promise<PrivateBookingGrowthSnapshot> {
  const supabase = createAdminClient()
  const now = new Date()
  const asOfDate = formatInTimeZone(now, LONDON_TIMEZONE, 'yyyy-MM-dd')

  const rows = await fetchAllRows<PrivateBookingGrowthRow>((from, to) =>
    supabase
      .from('private_bookings')
      .select('id,event_date,customer_name,event_type,guest_count,status,source,internal_notes')
      .order('event_date', { ascending: true })
      .range(from, to),
  )

  const productionRows = rows.filter(isProductionRecord)
  const pastRows = productionRows.filter((row) => row.event_date <= asOfDate)
  const records: PrivateBookingGrowthRecord[] = pastRows.map((row) => ({
    id: row.id,
    eventDate: row.event_date,
    customerName: row.customer_name,
    eventType: row.event_type?.trim() || 'Not recorded',
    guestCount: typeof row.guest_count === 'number' ? row.guest_count : null,
    status: row.status as 'confirmed' | 'completed',
    source: row.source,
    isHistoricalImport: row.internal_notes?.startsWith(HISTORICAL_IMPORT_MARKER) || false,
  }))

  return {
    generatedAt: now.toISOString(),
    asOfDate,
    firstRecordDate: records[0]?.eventDate || null,
    futureConfirmedCount: productionRows.filter(
      (row) => row.event_date > asOfDate && row.status === 'confirmed',
    ).length,
    excludedCount: rows.length - productionRows.length,
    records,
  }
}
