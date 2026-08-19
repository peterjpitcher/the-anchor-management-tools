import { describe, expect, it } from 'vitest'
import {
  daysBetweenIso,
  IMMINENT_WITHIN_DAYS,
  MAX_REMINDERS_PER_RUN,
  selectDueReminders,
  WAITING_AFTER_DAYS,
  wasTruncated,
  type PendingRequest,
} from '@/lib/leave/pending-reminders'

const TODAY = '2026-08-19'

function request(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id: 'req-1',
    employee_id: 'emp-1',
    start_date: '2026-09-30',
    end_date: '2026-10-02',
    created_at: '2026-08-18T09:00:00Z',
    status: 'pending',
    ...overrides,
  }
}

describe('daysBetweenIso', () => {
  it('counts whole days forwards and backwards', () => {
    expect(daysBetweenIso('2026-08-19', '2026-08-22')).toBe(3)
    expect(daysBetweenIso('2026-08-22', '2026-08-19')).toBe(-3)
    expect(daysBetweenIso('2026-08-19', '2026-08-19')).toBe(0)
  })

  it('is not thrown by a clock change', () => {
    // British Summer Time ends on 25 October 2026. A naive local-time subtraction gives 0.958
    // of a day here and rounds wrong; comparing UTC calendar dates does not.
    expect(daysBetweenIso('2026-10-24', '2026-10-26')).toBe(2)
  })
})

describe('selectDueReminders', () => {
  it('says nothing about a request raised today for leave months away', () => {
    const due = selectDueReminders([request({ created_at: `${TODAY}T08:00:00Z`, start_date: '2026-12-01' })], new Set(), TODAY)
    expect(due).toEqual([])
  })

  it('raises "waiting" once a request has sat unreviewed', () => {
    const due = selectDueReminders(
      [request({ created_at: '2026-08-10T09:00:00Z', start_date: '2026-12-01' })],
      new Set(), TODAY,
    )
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({ kind: 'waiting', daysWaiting: 9 })
  })

  it('raises "imminent" when the leave itself is close', () => {
    const due = selectDueReminders(
      [request({ created_at: `${TODAY}T08:00:00Z`, start_date: '2026-08-25' })],
      new Set(), TODAY,
    )
    expect(due.map(d => d.kind)).toEqual(['imminent'])
  })

  it('raises both kinds when a request is old AND about to start', () => {
    // The live case that prompted this: raised 17 July, leave starting 30 August.
    const due = selectDueReminders(
      [request({ created_at: '2026-07-17T22:42:00Z', start_date: '2026-08-30' })],
      new Set(), TODAY,
    )
    expect(due.map(d => d.kind).sort()).toEqual(['imminent', 'waiting'])
  })

  it('never repeats a reminder already in the ledger', () => {
    const old = request({ created_at: '2026-07-17T22:42:00Z', start_date: '2026-08-30' })
    const due = selectDueReminders([old], new Set(['req-1:waiting', 'req-1:imminent']), TODAY)
    expect(due).toEqual([])
  })

  it('still sends the other kind when only one has been sent', () => {
    const old = request({ created_at: '2026-07-17T22:42:00Z', start_date: '2026-08-30' })
    const due = selectDueReminders([old], new Set(['req-1:waiting']), TODAY)
    expect(due.map(d => d.kind)).toEqual(['imminent'])
  })

  it('ignores anything that is not pending', () => {
    const due = selectDueReminders(
      [request({ status: 'approved', created_at: '2026-07-01T09:00:00Z' })],
      new Set(), TODAY,
    )
    expect(due).toEqual([])
  })

  it('never chases holiday that was agreed when someone was hired', () => {
    // Those rows are written already approved, so they should not be in this queue at all.
    // Guarded regardless: asking a manager to approve something nobody asked them to approve is
    // the noise that gets a reminder job muted.
    const due = selectDueReminders(
      [request({ created_at: '2026-07-01T09:00:00Z', leave_origin: 'agreed_at_hire' })],
      new Set(), TODAY,
    )
    expect(due).toEqual([])
  })

  it('reminds about leave that has already started, which is the worst case', () => {
    const due = selectDueReminders(
      [request({ created_at: '2026-07-17T09:00:00Z', start_date: '2026-08-15' })],
      new Set(), TODAY,
    )
    expect(due.some(d => d.kind === 'imminent')).toBe(true)
    expect(due[0].daysUntilStart).toBeLessThan(0)
  })

  it('puts the most urgent first and caps the batch', () => {
    const many: PendingRequest[] = Array.from({ length: MAX_REMINDERS_PER_RUN + 10 }, (_, i) => request({
      id: `req-${i}`,
      created_at: '2026-07-01T09:00:00Z',
      start_date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    }))
    const due = selectDueReminders(many, new Set(), TODAY)

    expect(due).toHaveLength(MAX_REMINDERS_PER_RUN)
    expect(wasTruncated(due.length)).toBe(true)
    const gaps = due.map(d => d.daysUntilStart)
    expect([...gaps].sort((a, b) => a - b)).toEqual(gaps)
  })

  it('uses the documented thresholds', () => {
    expect(WAITING_AFTER_DAYS).toBe(3)
    expect(IMMINENT_WITHIN_DAYS).toBe(21)
  })
})
