import { describe, it, expect } from 'vitest'
import { birthdayOccurrencesInRange } from '@/lib/calendar/datasets'

const base = {
  employee_id: 'emp-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  preferred_name: null,
  job_title: 'Chef',
}

describe('birthdayOccurrencesInRange', () => {
  it('returns one occurrence per year inside the range', () => {
    const out = birthdayOccurrencesInRange(
      { ...base, date_of_birth: '1990-06-15' },
      '2026-01-01',
      '2027-12-31',
    )
    expect(out.map((o) => o.occurrence_date)).toEqual(['2026-06-15', '2027-06-15'])
    expect(out[0].turning_age).toBe(36)
  })

  it('observes a 29 February birthday on 28 February in a common year', () => {
    // Constructing 29 February in a common year rolls into March, which would
    // silently move the birthday. It is pulled back instead.
    const out = birthdayOccurrencesInRange(
      { ...base, date_of_birth: '1992-02-29' },
      '2026-01-01',
      '2026-12-31',
    )
    expect(out.map((o) => o.occurrence_date)).toEqual(['2026-02-28'])
  })

  it('keeps 29 February in a leap year', () => {
    const out = birthdayOccurrencesInRange(
      { ...base, date_of_birth: '1992-02-29' },
      '2028-01-01',
      '2028-12-31',
    )
    expect(out.map((o) => o.occurrence_date)).toEqual(['2028-02-29'])
  })

  it('excludes occurrences outside the range', () => {
    const out = birthdayOccurrencesInRange(
      { ...base, date_of_birth: '1990-01-05' },
      '2026-02-01',
      '2026-12-31',
    )
    expect(out).toEqual([])
  })

  it('returns nothing without a date of birth, or for an unparseable one', () => {
    expect(birthdayOccurrencesInRange({ ...base, date_of_birth: null }, '2026-01-01', '2026-12-31')).toEqual([])
    expect(
      birthdayOccurrencesInRange({ ...base, date_of_birth: 'not-a-date' }, '2026-01-01', '2026-12-31'),
    ).toEqual([])
  })
})
