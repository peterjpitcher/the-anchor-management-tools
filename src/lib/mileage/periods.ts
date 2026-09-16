/**
 * Report periods (spec 4.1): calendar quarters of the financial year (1 January to 31 December),
 * financial years, tax years (6 April to 5 April) and custom dates. Dates stay YYYY-MM-DD
 * strings; no local Date object is created, so the host timezone cannot move a boundary.
 */

export type ReportPeriodKind = 'quarter' | 'financial_year' | 'tax_year' | 'custom'

export interface ReportPeriod {
  kind: ReportPeriodKind
  from: string
  to: string
  label: string
  fileLabel: string
}

export const MAX_REPORT_DAYS = 1830

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const QUARTER_BOUNDS = [
  ['01-01', '03-31'],
  ['04-01', '06-30'],
  ['07-01', '09-30'],
  ['10-01', '12-31'],
] as const

function splitIso(isoDate: string): [number, number, number] {
  const [year, month, day] = isoDate.split('-').map(Number)
  return [year, month, day]
}

export function formatLongDate(isoDate: string): string {
  const [year, month, day] = splitIso(isoDate)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

function formatDayMonth(isoDate: string): string {
  const [, month, day] = splitIso(isoDate)
  return `${day} ${MONTHS[month - 1]}`
}

export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4): ReportPeriod {
  const [start, end] = QUARTER_BOUNDS[quarter - 1]
  const from = `${year}-${start}`
  const to = `${year}-${end}`
  return {
    kind: 'quarter',
    from,
    to,
    label: `Q${quarter} ${year}: ${formatDayMonth(from)} to ${formatLongDate(to)}`,
    fileLabel: `${year}-Q${quarter}`,
  }
}

export function financialYearPeriod(year: number): ReportPeriod {
  return {
    kind: 'financial_year',
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    label: `Financial year ${year}: 1 January to 31 December ${year}`,
    fileLabel: `FY${year}`,
  }
}

export function taxYearPeriod(startYear: number): ReportPeriod {
  const endShort = String((startYear + 1) % 100).padStart(2, '0')
  return {
    kind: 'tax_year',
    from: `${startYear}-04-06`,
    to: `${startYear + 1}-04-05`,
    label: `Tax year ${startYear}/${endShort}: 6 April ${startYear} to 5 April ${startYear + 1}`,
    fileLabel: `TY${startYear}-${endShort}`,
  }
}

export function customPeriod(from: string, to: string): ReportPeriod {
  return {
    kind: 'custom',
    from,
    to,
    label: `${formatLongDate(from)} to ${formatLongDate(to)}`,
    fileLabel: `${from}_to_${to}`,
  }
}

/** Recognises a quarter, financial year or tax year from its exact dates; anything else is custom. */
export function describePeriod(from: string, to: string): ReportPeriod {
  const year = Number(from.slice(0, 4))
  for (const quarter of [1, 2, 3, 4] as const) {
    const candidate = quarterPeriod(year, quarter)
    if (candidate.from === from && candidate.to === to) return candidate
  }
  const financialYear = financialYearPeriod(year)
  if (financialYear.from === from && financialYear.to === to) return financialYear
  const taxYear = taxYearPeriod(year)
  if (taxYear.from === from && taxYear.to === to) return taxYear
  return customPeriod(from, to)
}

/** The last calendar quarter that has fully ended, from a London calendar date. */
export function lastCompletedQuarter(todayIso: string): ReportPeriod {
  const [year, month] = splitIso(todayIso)
  const current = Math.floor((month - 1) / 3) + 1
  return current === 1 ? quarterPeriod(year - 1, 4) : quarterPeriod(year, (current - 1) as 1 | 2 | 3)
}

/** Whole days between two dates, counted on UTC midnights so no clock change can add an hour. */
export function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = splitIso(from)
  const [toYear, toMonth, toDay] = splitIso(to)
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000)
}
