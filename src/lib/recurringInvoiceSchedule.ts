import type { RecurringFrequency } from '@/types/invoices'

type IsoDateParts = {
  year: number
  month: number
  day: number
}

function parseIsoDate(value: string): IsoDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new Error(`Invalid ISO date (expected YYYY-MM-DD): ${value}`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid ISO date parts: ${value}`)
  }

  return { year, month, day }
}

function formatIsoDate(parts: IsoDateParts): string {
  const year = String(parts.year).padStart(4, '0')
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDaysIsoDate(isoDate: string, days: number): string {
  const { year, month, day } = parseIsoDate(isoDate)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function addMonthsIsoDate(isoDate: string, months: number): string {
  const { year, month, day } = parseIsoDate(isoDate)
  const totalMonths = year * 12 + (month - 1) + months
  const nextYear = Math.floor(totalMonths / 12)
  const nextMonthIndex = ((totalMonths % 12) + 12) % 12
  const nextMonth = nextMonthIndex + 1
  const clampedDay = Math.min(day, daysInMonth(nextYear, nextMonth))
  return formatIsoDate({ year: nextYear, month: nextMonth, day: clampedDay })
}

export function addYearsIsoDate(isoDate: string, years: number): string {
  const { year, month, day } = parseIsoDate(isoDate)
  const nextYear = year + years
  const clampedDay = Math.min(day, daysInMonth(nextYear, month))
  return formatIsoDate({ year: nextYear, month, day: clampedDay })
}

export function calculateNextInvoiceIsoDate(isoDate: string, frequency: RecurringFrequency): string {
  switch (frequency) {
    case 'weekly':
      return addDaysIsoDate(isoDate, 7)
    case 'monthly':
      return addMonthsIsoDate(isoDate, 1)
    case 'quarterly':
      return addMonthsIsoDate(isoDate, 3)
    case 'yearly':
      return addYearsIsoDate(isoDate, 1)
  }
}

