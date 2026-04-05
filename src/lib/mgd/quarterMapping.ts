/**
 * MGD (Machine Games Duty) Quarter Mapping
 *
 * MGD uses a non-standard quarterly cycle:
 *   Feb-Apr, May-Jul, Aug-Oct, Nov-Jan
 *
 * January belongs to the PREVIOUS year's Nov-Jan period.
 */

import { getTodayIsoDate } from '@/lib/dateUtils'

export interface MgdQuarter {
  periodStart: string
  periodEnd: string
  label: string
}

/**
 * Given a date, returns the MGD quarter it belongs to.
 *
 * Month mapping:
 * | Month       | period_start      | period_end         |
 * |-------------|-------------------|--------------------|
 * | Feb,Mar,Apr | YYYY-02-01        | YYYY-04-30         |
 * | May,Jun,Jul | YYYY-05-01        | YYYY-07-31         |
 * | Aug,Sep,Oct | YYYY-08-01        | YYYY-10-31         |
 * | Nov,Dec     | YYYY-11-01        | (YYYY+1)-01-31     |
 * | Jan         | (YYYY-1)-11-01    | YYYY-01-31         |
 */
export function getMgdQuarter(date: Date): MgdQuarter {
  const year = date.getFullYear()
  const month = date.getMonth() + 1 // 1-12

  if (month >= 2 && month <= 4) {
    return {
      periodStart: `${year}-02-01`,
      periodEnd: `${year}-04-30`,
      label: `Feb ${year} \u2014 Apr ${year}`,
    }
  }

  if (month >= 5 && month <= 7) {
    return {
      periodStart: `${year}-05-01`,
      periodEnd: `${year}-07-31`,
      label: `May ${year} \u2014 Jul ${year}`,
    }
  }

  if (month >= 8 && month <= 10) {
    return {
      periodStart: `${year}-08-01`,
      periodEnd: `${year}-10-31`,
      label: `Aug ${year} \u2014 Oct ${year}`,
    }
  }

  if (month >= 11) {
    // Nov or Dec — period spans into next year
    return {
      periodStart: `${year}-11-01`,
      periodEnd: `${year + 1}-01-31`,
      label: `Nov ${year} \u2014 Jan ${year + 1}`,
    }
  }

  // month === 1 (January) — belongs to previous year's Nov-Jan period
  return {
    periodStart: `${year - 1}-11-01`,
    periodEnd: `${year}-01-31`,
    label: `Nov ${year - 1} \u2014 Jan ${year}`,
  }
}

/**
 * Returns the MGD quarter for the current date (London timezone).
 */
export function getCurrentMgdQuarter(): MgdQuarter {
  const todayStr = getTodayIsoDate() // YYYY-MM-DD in Europe/London
  const [y, m, d] = todayStr.split('-').map(Number)
  return getMgdQuarter(new Date(y, m - 1, d))
}

/**
 * Generates all MGD quarters in the range [startYear, endYear].
 * Each calendar year contributes 4 quarters whose period_start falls in that year:
 *   Feb-Apr, May-Jul, Aug-Oct, Nov-Jan(next year)
 */
export function getAllMgdQuarters(startYear: number, endYear: number): MgdQuarter[] {
  const quarters: MgdQuarter[] = []

  for (let y = startYear; y <= endYear; y++) {
    quarters.push(getMgdQuarter(new Date(y, 1, 1)))   // Feb
    quarters.push(getMgdQuarter(new Date(y, 4, 1)))   // May
    quarters.push(getMgdQuarter(new Date(y, 7, 1)))   // Aug
    quarters.push(getMgdQuarter(new Date(y, 10, 1)))  // Nov
  }

  return quarters
}

/**
 * Maps a calendar quarter (Q1-Q4) to the MGD quarter that most overlaps it.
 *
 * Calendar Q1 (Jan-Mar) → Feb-Apr (2 of 3 months overlap)
 * Calendar Q2 (Apr-Jun) → May-Jul (2 of 3 months overlap)
 * Calendar Q3 (Jul-Sep) → Aug-Oct (2 of 3 months overlap)
 * Calendar Q4 (Oct-Dec) → Nov-Jan (2 of 3 months overlap)
 */
export function getCalendarQuarterMgdOverlap(
  year: number,
  quarter: 1 | 2 | 3 | 4
): { periodStart: string; periodEnd: string } {
  switch (quarter) {
    case 1:
      return { periodStart: `${year}-02-01`, periodEnd: `${year}-04-30` }
    case 2:
      return { periodStart: `${year}-05-01`, periodEnd: `${year}-07-31` }
    case 3:
      return { periodStart: `${year}-08-01`, periodEnd: `${year}-10-31` }
    case 4:
      return { periodStart: `${year}-11-01`, periodEnd: `${year + 1}-01-31` }
  }
}
