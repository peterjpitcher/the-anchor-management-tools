export type PrivateBookingGrowthRecord = {
  id: string
  eventDate: string
  customerName: string
  eventType: string
  guestCount: number | null
  status: 'confirmed' | 'completed'
  source: string | null
  isHistoricalImport: boolean
}

export type PrivateBookingGrowthRange = 'all' | 'five_years' | 'three_years'

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

function yearFromDate(value: string): number {
  return Number(value.slice(0, 4))
}

function monthFromDate(value: string): number {
  return Number(value.slice(5, 7))
}

export function categorisePrivateBookingOccasion(eventType: string | null | undefined): string {
  const value = eventType?.trim() || ''
  const normalized = value.toLowerCase()

  if (normalized.includes('birthday')) return 'Birthday'
  if (normalized.includes('christening') || normalized.includes('christering') || normalized.includes('baptism')) {
    return 'Christening and baptism'
  }
  if (normalized.includes('christmas')) return 'Christmas party'
  if (normalized.includes('baby shower') || normalized.includes('gender reveal') || normalized === 'gen party') {
    return 'Baby shower and reveal'
  }
  if (normalized.includes('celebration of life') || normalized.includes('wake') || normalized.includes('funeral')) {
    return 'Celebration of life'
  }
  if (normalized.includes('corporate') || normalized.includes('business') || normalized.includes('networking')) {
    return 'Corporate'
  }
  if (normalized.includes('wedding') || normalized.includes('anniversary')) return 'Wedding and anniversary'
  if (normalized.includes('stag') || normalized.includes('hen')) return 'Stag and hen'
  if (normalized.includes('dinner')) return 'Private dinner'
  return value || 'Not recorded'
}

export function resolvePrivateBookingRangeStartYear(
  range: PrivateBookingGrowthRange,
  firstYear: number,
  currentYear: number,
): number {
  if (range === 'three_years') return Math.max(firstYear, currentYear - 2)
  if (range === 'five_years') return Math.max(firstYear, currentYear - 4)
  return firstYear
}

export function buildAnnualPrivateBookingSeries(
  records: PrivateBookingGrowthRecord[],
  startYear: number,
  endYear: number,
) {
  const counts = new Map<number, number>()
  for (const record of records) {
    const year = yearFromDate(record.eventDate)
    counts.set(year, (counts.get(year) || 0) + 1)
  }

  let cumulative = 0
  return Array.from({ length: Math.max(0, endYear - startYear + 1) }, (_, index) => {
    const year = startYear + index
    const bookings = counts.get(year) || 0
    cumulative += bookings
    return {
      period: String(year),
      year,
      bookings,
      cumulative,
    }
  })
}

export function buildMonthlyPrivateBookingSeries(
  records: PrivateBookingGrowthRecord[],
  startYear: number,
  endDate: string,
) {
  const counts = new Map<string, number>()
  for (const record of records) {
    const period = record.eventDate.slice(0, 7)
    counts.set(period, (counts.get(period) || 0) + 1)
  }

  const endYear = yearFromDate(endDate)
  const endMonth = monthFromDate(endDate)
  const rows: Array<{
    period: string
    label: string
    bookings: number
    cumulative: number
  }> = []
  let cumulative = 0

  for (let year = startYear; year <= endYear; year += 1) {
    const finalMonth = year === endYear ? endMonth : 12
    for (let month = 1; month <= finalMonth; month += 1) {
      const period = `${year}-${String(month).padStart(2, '0')}`
      const bookings = counts.get(period) || 0
      cumulative += bookings
      rows.push({
        period,
        label: `${MONTH_LABELS[month - 1]} ${String(year).slice(2)}`,
        bookings,
        cumulative,
      })
    }
  }

  return rows
}

export function buildPrivateBookingSeasonality(records: PrivateBookingGrowthRecord[]) {
  const counts = new Array<number>(12).fill(0)
  for (const record of records) {
    const month = monthFromDate(record.eventDate)
    if (month >= 1 && month <= 12) counts[month - 1] += 1
  }

  return MONTH_LABELS.map((month, index) => ({
    month,
    bookings: counts[index],
  }))
}

export function countPrivateBookingsYearToDate(
  records: PrivateBookingGrowthRecord[],
  year: number,
  monthDayCutoff: string,
): number {
  return records.filter((record) => {
    return yearFromDate(record.eventDate) === year && record.eventDate.slice(5) <= monthDayCutoff
  }).length
}
