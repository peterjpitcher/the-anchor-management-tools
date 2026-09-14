import { describe, expect, it } from 'vitest'
import {
  buildAnnualPrivateBookingSeries,
  buildMonthlyPrivateBookingSeries,
  buildPrivateBookingSeasonality,
  categorisePrivateBookingOccasion,
  countPrivateBookingsYearToDate,
  resolvePrivateBookingRangeStartYear,
  type PrivateBookingGrowthRecord,
} from '@/lib/analytics/private-booking-growth-model'

const records: PrivateBookingGrowthRecord[] = [
  { id: 'a', eventDate: '2019-08-23', customerName: 'A', eventType: 'Birthday Party', guestCount: 40, status: 'completed', source: 'other', isHistoricalImport: true },
  { id: 'b', eventDate: '2019-12-07', customerName: 'B', eventType: 'Company Christmas party', guestCount: 60, status: 'completed', source: 'other', isHistoricalImport: true },
  { id: 'c', eventDate: '2021-01-15', customerName: 'C', eventType: 'Christering', guestCount: null, status: 'confirmed', source: 'admin', isHistoricalImport: false },
  { id: 'd', eventDate: '2021-10-20', customerName: 'D', eventType: 'Baby Shower', guestCount: 30, status: 'confirmed', source: 'admin', isHistoricalImport: false },
]

describe('private booking growth model', () => {
  it('preserves zero-booking years and builds a cumulative total', () => {
    expect(buildAnnualPrivateBookingSeries(records, 2019, 2021)).toEqual([
      { period: '2019', year: 2019, bookings: 2, cumulative: 2 },
      { period: '2020', year: 2020, bookings: 0, cumulative: 2 },
      { period: '2021', year: 2021, bookings: 2, cumulative: 4 },
    ])
  })

  it('builds monthly rows through the supplied cutoff without inventing future months', () => {
    const series = buildMonthlyPrivateBookingSeries(records, 2021, '2021-03-14')
    expect(series).toEqual([
      { period: '2021-01', label: 'Jan 21', bookings: 1, cumulative: 1 },
      { period: '2021-02', label: 'Feb 21', bookings: 0, cumulative: 1 },
      { period: '2021-03', label: 'Mar 21', bookings: 0, cumulative: 1 },
    ])
  })

  it('combines spelling and naming variations into useful occasion categories', () => {
    expect(categorisePrivateBookingOccasion('18th Birthday party')).toBe('Birthday')
    expect(categorisePrivateBookingOccasion('Christering')).toBe('Christening and baptism')
    expect(categorisePrivateBookingOccasion('Business Dinner & Karaoke')).toBe('Corporate')
    expect(categorisePrivateBookingOccasion(null)).toBe('Not recorded')
  })

  it('counts year-to-date records at the same month and day boundary', () => {
    expect(countPrivateBookingsYearToDate(records, 2021, '09-14')).toBe(1)
    expect(countPrivateBookingsYearToDate(records, 2021, '12-31')).toBe(2)
  })

  it('builds the month-of-year distribution', () => {
    const seasonality = buildPrivateBookingSeasonality(records)
    expect(seasonality[0]).toEqual({ month: 'Jan', bookings: 1 })
    expect(seasonality[7]).toEqual({ month: 'Aug', bookings: 1 })
    expect(seasonality[11]).toEqual({ month: 'Dec', bookings: 1 })
  })

  it('keeps rolling year filters inside the available record range', () => {
    expect(resolvePrivateBookingRangeStartYear('all', 2019, 2026)).toBe(2019)
    expect(resolvePrivateBookingRangeStartYear('five_years', 2019, 2026)).toBe(2022)
    expect(resolvePrivateBookingRangeStartYear('three_years', 2025, 2026)).toBe(2025)
  })
})
