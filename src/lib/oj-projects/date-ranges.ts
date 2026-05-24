import { getTodayIsoDate } from '@/lib/dateUtils'

export function getCurrentMonthEntryDateRange(): { startDate: string; endDate: string } {
  const today = getTodayIsoDate()
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const startDate = `${today.slice(0, 7)}-01`
  const nextMonthStartUtc = new Date(Date.UTC(year, month, 1))
  const endDate = new Date(nextMonthStartUtc.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  return { startDate, endDate }
}
