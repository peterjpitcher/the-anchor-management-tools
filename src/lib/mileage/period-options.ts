/**
 * Period choices for the report dialog and the trips page (spec 6.4 and 7.1): the quarters, financial
 * years and tax years that overlap a date range, newest first. Each value is the period's file label,
 * which is unique within its list. Dates stay YYYY-MM-DD strings, so the host timezone cannot move a
 * boundary.
 */

import { financialYearPeriod, quarterPeriod, taxYearPeriod, type ReportPeriod } from './periods'

interface PeriodOption {
  value: string
  label: string
  period: ReportPeriod
}

function toOption(period: ReportPeriod): PeriodOption {
  return { value: period.fileLabel, label: period.label, period }
}

function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4))
}

/** A tax year starts on 6 April, so an earlier date belongs to the tax year that started the year before. */
function taxYearStartYear(isoDate: string): number {
  return isoDate.slice(5) >= '04-06' ? yearOf(isoDate) : yearOf(isoDate) - 1
}

export function quarterOptions(fromIso: string, toIso: string): PeriodOption[] {
  const options: PeriodOption[] = []
  for (let year = yearOf(toIso); year >= yearOf(fromIso); year -= 1) {
    for (const quarter of [4, 3, 2, 1] as const) {
      const period = quarterPeriod(year, quarter)
      if (period.from <= toIso && period.to >= fromIso) options.push(toOption(period))
    }
  }
  return options
}

export function financialYearOptions(fromIso: string, toIso: string): PeriodOption[] {
  const options: PeriodOption[] = []
  for (let year = yearOf(toIso); year >= yearOf(fromIso); year -= 1) {
    options.push(toOption(financialYearPeriod(year)))
  }
  return options
}

export function taxYearOptions(fromIso: string, toIso: string): PeriodOption[] {
  const options: PeriodOption[] = []
  for (let start = taxYearStartYear(toIso); start >= taxYearStartYear(fromIso); start -= 1) {
    options.push(toOption(taxYearPeriod(start)))
  }
  return options
}
