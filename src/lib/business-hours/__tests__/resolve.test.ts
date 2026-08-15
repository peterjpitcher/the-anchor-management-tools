import { describe, expect, it } from 'vitest'
import {
  missingWeekdays,
  resolveForDates,
  versionForDate,
  weekdayOfIsoDate,
  type LoadedVersion,
} from '@/lib/business-hours/resolve'

interface Row {
  day_of_week: number
  label: string
}

/** Seven rows for a version, labelled so the tests can see which one won. */
function week(label: string): Row[] {
  return [0, 1, 2, 3, 4, 5, 6].map(day => ({ day_of_week: day, label: `${label}-${day}` }))
}

const BASELINE: LoadedVersion<Row> = { effectiveFrom: '2000-01-01', rows: week('baseline') }
const SEPTEMBER: LoadedVersion<Row> = { effectiveFrom: '2026-09-01', rows: week('september') }
const OCTOBER: LoadedVersion<Row> = { effectiveFrom: '2026-10-01', rows: week('october') }

describe('weekdayOfIsoDate', () => {
  // The whole point: business_hours.day_of_week is 0 = Sunday, matching
  // PostgreSQL's EXTRACT(DOW). getIsoWeekday in dateUtils is 1 = Monday, and
  // using it here would shift every day and ask for a nonexistent day 7.
  it('returns 0 for a Sunday', () => {
    expect(weekdayOfIsoDate('2026-08-16')).toBe(0)
  })

  it('returns 6 for a Saturday', () => {
    expect(weekdayOfIsoDate('2026-08-15')).toBe(6)
  })

  it('returns 2 for a Tuesday', () => {
    expect(weekdayOfIsoDate('2026-09-01')).toBe(2)
  })

  it('is not shifted by British Summer Time', () => {
    // A date in BST and one in GMT, both Wednesdays.
    expect(weekdayOfIsoDate('2026-07-15')).toBe(3)
    expect(weekdayOfIsoDate('2026-01-14')).toBe(3)
  })

  it('rejects a malformed date', () => {
    expect(weekdayOfIsoDate('15/08/2026')).toBeNull()
    expect(weekdayOfIsoDate('2026-8-15')).toBeNull()
    expect(weekdayOfIsoDate('')).toBeNull()
  })

  it('rejects a date that does not exist', () => {
    expect(weekdayOfIsoDate('2026-02-30')).toBeNull()
    expect(weekdayOfIsoDate('2026-13-01')).toBeNull()
  })
})

describe('versionForDate', () => {
  const versions = [BASELINE, SEPTEMBER, OCTOBER]

  it('picks the baseline before any change', () => {
    expect(versionForDate(versions, '2026-08-31')?.effectiveFrom).toBe('2000-01-01')
  })

  it('picks a version on its own effective date', () => {
    expect(versionForDate(versions, '2026-09-01')?.effectiveFrom).toBe('2026-09-01')
  })

  it('keeps a version until the next one starts', () => {
    expect(versionForDate(versions, '2026-09-30')?.effectiveFrom).toBe('2026-09-01')
  })

  it('moves on at the next effective date', () => {
    expect(versionForDate(versions, '2026-10-01')?.effectiveFrom).toBe('2026-10-01')
  })

  it('returns null before every version', () => {
    expect(versionForDate([SEPTEMBER], '2026-08-31')).toBeNull()
  })
})

describe('resolveForDates', () => {
  it('resolves either side of an effective date', () => {
    const out = resolveForDates([BASELINE, SEPTEMBER], ['2026-08-31', '2026-09-01'])
    // 31 Aug 2026 is a Monday, 1 Sep a Tuesday.
    expect(out.get('2026-08-31')?.label).toBe('baseline-1')
    expect(out.get('2026-09-01')?.label).toBe('september-2')
  })

  it('handles a week that spans the boundary', () => {
    const dates = ['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']
    const out = resolveForDates([BASELINE, SEPTEMBER], dates)
    expect([...out.values()].map(r => r.label)).toEqual([
      'baseline-6', // Sat 29 Aug
      'baseline-0', // Sun 30 Aug
      'baseline-1', // Mon 31 Aug
      'september-2', // Tue 1 Sep
      'september-3', // Wed 2 Sep
    ])
  })

  it('honours a third version', () => {
    const out = resolveForDates([BASELINE, SEPTEMBER, OCTOBER], ['2026-09-15', '2026-10-15'])
    expect(out.get('2026-09-15')?.label).toBe('september-2')
    expect(out.get('2026-10-15')?.label).toBe('october-4')
  })

  it('does not care what order the versions arrive in', () => {
    const out = resolveForDates([OCTOBER, BASELINE, SEPTEMBER], ['2026-09-15'])
    expect(out.get('2026-09-15')?.label).toBe('september-2')
  })

  it('omits a date with no applicable version rather than guessing', () => {
    const out = resolveForDates([SEPTEMBER], ['2026-08-01', '2026-09-01'])
    expect(out.has('2026-08-01')).toBe(false)
    expect(out.has('2026-09-01')).toBe(true)
  })

  it('omits a weekday the version does not carry', () => {
    const partial: LoadedVersion<Row> = {
      effectiveFrom: '2026-09-01',
      rows: week('partial').filter(r => r.day_of_week !== 3),
    }
    const out = resolveForDates([partial], ['2026-09-02', '2026-09-03'])
    expect(out.has('2026-09-02')).toBe(false) // Wednesday, missing
    expect(out.get('2026-09-03')?.label).toBe('partial-4')
  })

  it('skips malformed dates without throwing', () => {
    const out = resolveForDates([BASELINE], ['not-a-date', '2026-09-01'])
    expect(out.size).toBe(1)
  })

  it('resolves a full year in one pass', () => {
    const dates: string[] = []
    for (let i = 0; i < 366; i++) {
      const d = new Date(Date.UTC(2026, 0, 1))
      d.setUTCDate(d.getUTCDate() + i)
      dates.push(d.toISOString().slice(0, 10))
    }
    const out = resolveForDates([BASELINE, SEPTEMBER], dates)
    expect(out.size).toBe(366)
    // Everything from 1 September onwards must be on the new version.
    expect(out.get('2026-08-31')?.label.startsWith('baseline')).toBe(true)
    expect(out.get('2026-09-01')?.label.startsWith('september')).toBe(true)
    expect(out.get('2026-12-31')?.label.startsWith('september')).toBe(true)
  })
})

describe('missingWeekdays', () => {
  it('is empty for a complete version', () => {
    expect(missingWeekdays(BASELINE)).toEqual([])
  })

  it('lists the gaps', () => {
    const partial: LoadedVersion<Row> = {
      effectiveFrom: '2026-09-01',
      rows: week('p').filter(r => r.day_of_week !== 0 && r.day_of_week !== 5),
    }
    expect(missingWeekdays(partial)).toEqual([0, 5])
  })
})
