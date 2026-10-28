import { describe, expect, it } from 'vitest'
import { holdCoversStart, holdSearchBounds } from '@/lib/table-bookings/hold-window'

// BK-211: hold dates and times are London wall clock, not UTC days.
describe('table hold window', () => {
  it('searches from London midnight, open ended when ends_on is null', () => {
    expect(holdSearchBounds({ starts_on: '2026-07-01', ends_on: null })).toEqual({
      fromIso: '2026-06-30T23:00:00.000Z',
      beforeIso: null,
    })
    expect(holdSearchBounds({ starts_on: '2026-12-01', ends_on: '2026-12-02' })).toEqual({
      fromIso: '2026-12-01T00:00:00.000Z',
      beforeIso: '2026-12-04T00:00:00.000Z',
    })
  })

  it('counts a 00:30 BST booking on the London day, not the UTC day before', () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in London.
    expect(holdCoversStart({ starts_on: '2026-07-01', ends_on: '2026-07-01' }, '2026-06-30T23:30:00Z')).toBe(true)
    expect(holdCoversStart({ starts_on: '2026-07-02', ends_on: '2026-07-02' }, '2026-06-30T23:30:00Z')).toBe(false)
  })

  it('treats a null ends_on as open ended', () => {
    expect(holdCoversStart({ starts_on: '2026-07-01', ends_on: null }, '2027-01-15T19:00:00Z')).toBe(true)
  })

  it('respects the daily time window', () => {
    const hold = { starts_on: '2026-07-01', ends_on: '2026-07-31', starts_at: '17:00', ends_at: '21:00' }
    expect(holdCoversStart(hold, '2026-07-10T17:30:00Z')).toBe(true) // 18:30 BST
    expect(holdCoversStart(hold, '2026-07-10T11:00:00Z')).toBe(false) // 12:00 BST
  })

  it('handles a window that crosses midnight against the previous day', () => {
    const hold = { starts_on: '2026-07-10', ends_on: '2026-07-10', starts_at: '22:00', ends_at: '02:00' }
    // 01:00 BST on 11 July belongs to the 10 July window.
    expect(holdCoversStart(hold, '2026-07-11T00:00:00Z')).toBe(true)
    // 01:00 BST on 10 July belongs to the 9 July window, before the hold starts.
    expect(holdCoversStart(hold, '2026-07-10T00:00:00Z')).toBe(false)
  })

  it('respects the weekday (0 = Sunday)', () => {
    const sundaysOnly = { starts_on: '2026-07-01', ends_on: null, day_of_week: 0 }
    expect(holdCoversStart(sundaysOnly, '2026-07-12T12:00:00Z')).toBe(true) // Sunday 12 July
    expect(holdCoversStart(sundaysOnly, '2026-07-11T12:00:00Z')).toBe(false) // Saturday
  })
})
