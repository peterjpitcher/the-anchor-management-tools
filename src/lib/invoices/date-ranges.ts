import { toLocalIsoDate } from '@/lib/dateUtils'

export function getCurrentQuarterDateRange(now = new Date()) {
  const currentQuarter = Math.floor(now.getMonth() / 3)
  const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1)
  const quarterEnd = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0)

  return {
    startDate: toLocalIsoDate(quarterStart),
    endDate: toLocalIsoDate(quarterEnd),
  }
}
