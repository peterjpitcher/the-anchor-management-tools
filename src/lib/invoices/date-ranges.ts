import { toLocalIsoDate } from '@/lib/dateUtils'

// Last day of each quarter, indexed by quarter (0 = Jan-Mar).
const QUARTER_END_MONTH_DAY = ['03-31', '06-30', '09-30', '12-31'] as const

/**
 * Start and end of the quarter that `now` falls in, as YYYY-MM-DD strings.
 * The quarter is read from the London calendar date, so a browser in another timezone
 * still gets the venue's quarter, and the range is built as strings rather than through
 * `new Date(year, month, day)`, which would anchor midnight in the host's timezone and
 * report the previous day once formatted in London.
 */
export function getCurrentQuarterDateRange(now = new Date()) {
  const [year, month] = toLocalIsoDate(now).split('-').map(Number)
  const quarter = Math.floor((month - 1) / 3)
  const startMonth = String(quarter * 3 + 1).padStart(2, '0')

  return {
    startDate: `${year}-${startMonth}-01`,
    endDate: `${year}-${QUARTER_END_MONTH_DAY[quarter]}`,
  }
}
