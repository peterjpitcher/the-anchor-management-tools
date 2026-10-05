// The staff portal's calendar note reader. It runs on the service-role client for people who
// could not read the table themselves, so these tests pin what it asks for and what it returns.

import { describe, expect, it, vi } from 'vitest'

import {
  STAFF_NOTES_MIN_DAYS_AHEAD,
  loadStaffCalendarNotes,
  staffNotesWindow,
} from '@/lib/portal/staff-calendar-notes'

type QueryResult = { data: unknown; error: unknown }

function fakeAdmin(result: QueryResult | Error) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'lte', 'or', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  // The query is awaited directly, so the builder is the thing that resolves.
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
    result instanceof Error
      ? Promise.reject(result).then(resolve, reject)
      : Promise.resolve(result).then(resolve, reject)

  const from = vi.fn().mockReturnValue(builder)
  return { admin: { from }, calls, from }
}

const WINDOW = { start: '2026-10-05', end: '2026-11-02' }

describe('staffNotesWindow', () => {
  it('starts today and runs four weeks ahead when the pay period ends sooner', () => {
    // 5 October 2026 plus 28 days is 2 November, past the period end of 24 October.
    expect(STAFF_NOTES_MIN_DAYS_AHEAD).toBe(28)
    expect(staffNotesWindow('2026-10-05', '2026-09-25', '2026-10-24')).toEqual({
      start: '2026-10-05',
      end: '2026-11-02',
    })
  })

  it('runs to the end of the pay period when that is later than four weeks ahead', () => {
    expect(staffNotesWindow('2026-09-25', '2026-09-25', '2026-10-24')).toEqual({
      start: '2026-09-25',
      end: '2026-10-24',
    })
  })

  it('covers a pay period still to come from its first day', () => {
    expect(staffNotesWindow('2026-10-05', '2026-11-25', '2026-12-24')).toEqual({
      start: '2026-11-25',
      end: '2026-12-24',
    })
  })

  it('still looks four weeks ahead on the last day of a pay period', () => {
    // The clocks go back on 25 October 2026, the day after this period ends.
    expect(staffNotesWindow('2026-10-24', '2026-09-25', '2026-10-24')).toEqual({
      start: '2026-10-24',
      end: '2026-11-21',
    })
  })

  it('has no window for a pay period that has finished', () => {
    expect(staffNotesWindow('2026-10-05', '2026-08-25', '2026-09-24')).toBeNull()
  })

  it('crosses the clock change without losing or gaining a day', () => {
    expect(staffNotesWindow('2027-03-20', '2027-02-25', '2027-03-24')?.end).toBe('2027-04-17')
  })
})

describe('loadStaffCalendarNotes', () => {
  it('asks only for notes ticked "Show to staff"', async () => {
    const { admin, calls, from } = fakeAdmin({ data: [], error: null })

    await loadStaffCalendarNotes(admin, WINDOW)

    expect(from).toHaveBeenCalledWith('calendar_notes')
    expect(calls).toContainEqual({ method: 'eq', args: ['show_to_staff', true] })
  })

  it('never reads the detail text, which is written for managers', async () => {
    const { admin, calls } = fakeAdmin({ data: [], error: null })

    await loadStaffCalendarNotes(admin, WINDOW)

    const select = calls.find((call) => call.method === 'select')
    expect(select?.args).toEqual(['id, note_date, end_date, title'])
  })

  it('finds notes that touch the window, including one-day notes with no end date', async () => {
    const { admin, calls } = fakeAdmin({ data: [], error: null })

    await loadStaffCalendarNotes(admin, WINDOW)

    expect(calls).toContainEqual({ method: 'lte', args: ['note_date', '2026-11-02'] })
    expect(calls).toContainEqual({
      method: 'or',
      args: ['end_date.gte.2026-10-05,and(end_date.is.null,note_date.gte.2026-10-05)'],
    })
  })

  it('returns title and dates, treating a blank end date as a one-day note', async () => {
    const { admin } = fakeAdmin({
      data: [
        { id: 'a', note_date: '2026-10-17', end_date: '2026-10-30', title: 'Bill & Pete Away (confirmed)' },
        { id: 'b', note_date: '2026-10-25', end_date: null, title: '  Clocks go back ' },
      ],
      error: null,
    })

    const result = await loadStaffCalendarNotes(admin, WINDOW)

    expect(result).toEqual({
      ok: true,
      notes: [
        { id: 'a', title: 'Bill & Pete Away (confirmed)', startDate: '2026-10-17', endDate: '2026-10-30' },
        { id: 'b', title: 'Clocks go back', startDate: '2026-10-25', endDate: '2026-10-25' },
      ],
    })
  })

  it('drops a row it cannot show rather than rendering a blank line', async () => {
    const { admin } = fakeAdmin({
      data: [
        { id: 'a', note_date: null, end_date: null, title: 'No date' },
        { id: 'b', note_date: '2026-10-25', end_date: null, title: '   ' },
      ],
      error: null,
    })

    expect(await loadStaffCalendarNotes(admin, WINDOW)).toEqual({ ok: true, notes: [] })
  })

  it('reports a failed read instead of pretending there are no notes', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin } = fakeAdmin({
      data: null,
      error: { message: 'column calendar_notes.show_to_staff does not exist' },
    })

    expect(await loadStaffCalendarNotes(admin, WINDOW)).toEqual({ ok: false })
    expect(errorLog).toHaveBeenCalled()
    errorLog.mockRestore()
  })

  it('reports a thrown error the same way, so the page still renders', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin } = fakeAdmin(new Error('fetch failed'))

    expect(await loadStaffCalendarNotes(admin, WINDOW)).toEqual({ ok: false })
    errorLog.mockRestore()
  })
})
