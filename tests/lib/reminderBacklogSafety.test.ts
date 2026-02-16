import { describe, expect, it } from 'vitest'
import {
  assertNoInvalidPastEventReminderRows,
  extractUniqueRowIds,
  selectPastEventReminderIds
} from '@/lib/reminder-backlog-safety'

describe('reminder backlog safety', () => {
  it('extracts unique string ids and rejects duplicates', () => {
    expect(
      extractUniqueRowIds({
        operation: 'Load pending reminder jobs',
        rows: [{ id: 'job-1' }, { id: 'job-2' }]
      })
    ).toEqual(['job-1', 'job-2'])

    expect(() =>
      extractUniqueRowIds({
        operation: 'Load pending reminder jobs',
        rows: [{ id: 'job-1' }, { id: 'job-1' }]
      })
    ).toThrow('Load pending reminder jobs returned duplicate ids: job-1')
  })

  it('rejects rows with missing ids', () => {
    expect(() =>
      extractUniqueRowIds({
        operation: 'Load pending reminder jobs',
        rows: [{ id: 'job-1' }, { id: null }]
      })
    ).toThrow('Load pending reminder jobs returned rows with invalid ids: row#2')
  })

  it('selects only reminders tied to past events', () => {
    const { pastReminderIds, invalidReminderIds } = selectPastEventReminderIds({
      todayIsoDate: '2026-02-14',
      rows: [
        {
          id: 'reminder-past',
          booking: { event: { date: '2026-02-01' } }
        },
        {
          id: 'reminder-today',
          booking: { event: { date: '2026-02-14' } }
        },
        {
          id: 'reminder-future',
          booking: { event: { date: '2026-02-20' } }
        }
      ]
    })

    expect(pastReminderIds).toEqual(['reminder-past'])
    expect(invalidReminderIds).toEqual([])
  })

  it('flags reminders with missing/invalid event date context', () => {
    const { pastReminderIds, invalidReminderIds } = selectPastEventReminderIds({
      todayIsoDate: '2026-02-14',
      rows: [
        {
          id: 'reminder-missing-event',
          booking: null
        },
        {
          id: 'reminder-invalid-date',
          booking: { event: { date: '14/02/2026' } }
        }
      ]
    })

    expect(pastReminderIds).toEqual([])
    expect(invalidReminderIds).toEqual([
      'reminder-missing-event',
      'reminder-invalid-date'
    ])
  })

  it('flags duplicate reminder ids as invalid context for fail-closed processing', () => {
    const { pastReminderIds, invalidReminderIds } = selectPastEventReminderIds({
      todayIsoDate: '2026-02-14',
      rows: [
        {
          id: 'reminder-duplicate',
          booking: { event: { date: '2026-02-01' } }
        },
        {
          id: 'reminder-duplicate',
          booking: { event: { date: '2026-02-01' } }
        }
      ]
    })

    expect(pastReminderIds).toEqual(['reminder-duplicate'])
    expect(invalidReminderIds).toEqual(['reminder-duplicate'])
  })

  it('supports relation arrays returned by nested Supabase selects', () => {
    const { pastReminderIds, invalidReminderIds } = selectPastEventReminderIds({
      todayIsoDate: '2026-02-14',
      rows: [
        {
          id: 'reminder-array-shape',
          booking: [{ event: [{ date: '2026-01-31' }] }]
        }
      ]
    })

    expect(pastReminderIds).toEqual(['reminder-array-shape'])
    expect(invalidReminderIds).toEqual([])
  })

  it('fails closed when invalid reminder rows are present', () => {
    expect(() =>
      assertNoInvalidPastEventReminderRows([
        'reminder-a',
        'reminder-b'
      ])
    ).toThrow(
      'Cannot safely process pending reminders because 2 row(s) have invalid event context: reminder-a, reminder-b'
    )

    expect(() => assertNoInvalidPastEventReminderRows([])).not.toThrow()
  })
})
