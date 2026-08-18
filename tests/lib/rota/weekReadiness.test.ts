import { describe, expect, it } from 'vitest'
import {
  getRotaWeekReadiness,
  outOfOrderPublishReason,
  readinessWeekFromRow,
  summariseRotaReadiness,
  type RotaReadinessWeek,
  type RotaWeekReadinessInput,
} from '@/lib/rota/week-readiness'
import type { PublishedShiftSnapshot, RotaPublishShift } from '@/lib/rota/publish-status'

const PUBLISHED_AT = '2026-08-10T17:00:00.000Z'

function snapshot(overrides: Partial<PublishedShiftSnapshot> = {}): PublishedShiftSnapshot {
  return {
    id: 'shift-1',
    employee_id: 'employee-1',
    shift_date: '2026-08-31',
    start_time: '16:00:00',
    end_time: '22:00:00',
    unpaid_break_minutes: 0,
    department: 'bar',
    status: 'scheduled',
    notes: null,
    is_overnight: false,
    is_open_shift: false,
    name: 'Monday',
    ...overrides,
  }
}

function live(overrides: Partial<RotaPublishShift> = {}): RotaPublishShift {
  return { ...snapshot(), created_at: null, updated_at: null, ...overrides }
}

function week(overrides: Partial<RotaReadinessWeek> = {}): RotaReadinessWeek {
  return { weekStart: '2026-08-31', status: 'draft', publishedAt: null, ...overrides }
}

function entry(
  weekStart: string,
  status: RotaReadinessWeek['status'],
  publishedAt: string | null,
  liveShifts: RotaPublishShift[] = [],
  publishedShifts: PublishedShiftSnapshot[] = [],
): RotaWeekReadinessInput {
  return { week: { weekStart, status, publishedAt }, liveShifts, publishedShifts }
}

describe('readinessWeekFromRow', () => {
  it('treats an absent rota_weeks row as a missing week', () => {
    expect(readinessWeekFromRow('2026-08-31', null)).toEqual({
      weekStart: '2026-08-31',
      status: 'missing',
      publishedAt: null,
    })
  })

  it('maps a published row onto the readiness shape', () => {
    expect(readinessWeekFromRow('2026-09-07', { status: 'published', published_at: PUBLISHED_AT })).toEqual({
      weekStart: '2026-09-07',
      status: 'published',
      publishedAt: PUBLISHED_AT,
    })
  })
})

describe('getRotaWeekReadiness', () => {
  it('reports a week with no rota_weeks row as missing and counts its shifts as unseen', () => {
    const readiness = getRotaWeekReadiness(week({ status: 'missing' }), [live()], [])

    expect(readiness.state).toBe('missing')
    expect(readiness.unpublishedCount).toBe(1)
    expect(readiness.removedCount).toBe(0)
    expect(readiness.reasons[0]).toContain('no rota week record')
  })

  it('reports a draft week as draft with every shift still unseen', () => {
    const readiness = getRotaWeekReadiness(week(), [live(), live({ id: 'shift-2' })], [])

    expect(readiness.state).toBe('draft')
    expect(readiness.unpublishedCount).toBe(2)
    expect(readiness.reasons).toContain('2 shifts are waiting to be published.')
  })

  it('does not count sick shifts or handed-back open shifts against a draft week', () => {
    const readiness = getRotaWeekReadiness(
      week(),
      [
        live({ id: 'shift-sick', status: 'sick' }),
        live({ id: 'shift-open', is_open_shift: true, reassignment_reason: "Couldn't Work: away" }),
      ],
      [],
    )

    expect(readiness.state).toBe('draft')
    expect(readiness.unpublishedCount).toBe(0)
    expect(readiness.reasons).toContain('The week has no shifts on it yet.')
  })

  it('reports a published week that matches its snapshot as current with no reasons', () => {
    const readiness = getRotaWeekReadiness(
      week({ status: 'published', publishedAt: PUBLISHED_AT }),
      [live()],
      [snapshot()],
    )

    expect(readiness.state).toBe('published_current')
    expect(readiness.unpublishedCount).toBe(0)
    expect(readiness.removedCount).toBe(0)
    expect(readiness.reasons).toEqual([])
  })

  it('reports additions and edits made since publish as stale', () => {
    const readiness = getRotaWeekReadiness(
      week({ status: 'published', publishedAt: PUBLISHED_AT }),
      [live({ start_time: '17:00:00' }), live({ id: 'shift-2' })],
      [snapshot()],
    )

    expect(readiness.state).toBe('published_stale')
    expect(readiness.unpublishedCount).toBe(2)
    expect(readiness.removedCount).toBe(0)
    expect(readiness.reasons).toContain('2 shifts have been added or changed since the week was published.')
  })

  it('reports shifts deleted since publish as ghost shifts staff can still see', () => {
    const readiness = getRotaWeekReadiness(
      week({ status: 'published', publishedAt: PUBLISHED_AT }),
      [live()],
      [snapshot(), snapshot({ id: 'shift-2' })],
    )

    expect(readiness.state).toBe('published_stale')
    expect(readiness.unpublishedCount).toBe(0)
    expect(readiness.removedCount).toBe(1)
    expect(readiness.reasons[0]).toContain('been deleted since the week was published')
  })

  it('reports a week marked published with no publish time as stale, not current', () => {
    const readiness = getRotaWeekReadiness(week({ status: 'published' }), [live()], [])

    expect(readiness.state).toBe('published_stale')
    expect(readiness.unpublishedCount).toBe(1)
    expect(readiness.reasons[0]).toContain('never sent to staff')
  })

  it('ignores has_unpublished_changes and trusts the snapshot diff instead', () => {
    // The flag is written in a separate unchecked call, so a dirty week can look
    // clean. Readiness must still report the drift.
    const row = { status: 'published', published_at: PUBLISHED_AT, has_unpublished_changes: false }

    const readiness = getRotaWeekReadiness(
      readinessWeekFromRow('2026-09-07', row),
      [live({ id: 'shift-added' })],
      [],
    )

    expect(readiness.state).toBe('published_stale')
    expect(readiness.unpublishedCount).toBe(1)
  })
})

describe('summariseRotaReadiness', () => {
  it('flags the out-of-order gap where a draft week sits before a published one', () => {
    // Live in production: 2026-08-31 is draft while 2026-09-07 after it is published.
    const summary = summariseRotaReadiness(
      [
        entry('2026-09-07', 'published', PUBLISHED_AT, [live({ shift_date: '2026-09-07' })], [
          snapshot({ shift_date: '2026-09-07' }),
        ]),
        entry('2026-08-31', 'draft', null, [live()]),
      ],
      4,
    )

    expect(summary.byWeek.map(readiness => readiness.weekStart)).toEqual(['2026-08-31', '2026-09-07'])
    expect(summary.byWeek[0].state).toBe('draft')
    expect(summary.byWeek[0].reasons).toContain(outOfOrderPublishReason('2026-09-07'))
    expect(summary.byWeek[1].state).toBe('published_current')
    expect(summary.byWeek[1].reasons).toEqual([])
    expect(summary.weeksNeedingAttention).toBe(1)
    expect(summary.firstProblemWeekStart).toBe('2026-08-31')
  })

  it('flags a missing week that sits before a published one', () => {
    const summary = summariseRotaReadiness(
      [
        entry('2026-08-31', 'missing', null),
        entry('2026-09-07', 'published', PUBLISHED_AT),
      ],
      4,
    )

    expect(summary.byWeek[0].state).toBe('missing')
    expect(summary.byWeek[0].reasons).toContain(outOfOrderPublishReason('2026-09-07'))
  })

  it('does not raise the out-of-order reason when the later week was never actually sent', () => {
    const summary = summariseRotaReadiness(
      [
        entry('2026-08-31', 'draft', null, [live()]),
        entry('2026-09-07', 'published', null, [live({ shift_date: '2026-09-07' })]),
      ],
      4,
    )

    expect(summary.byWeek[0].reasons).not.toContain(outOfOrderPublishReason('2026-09-07'))
    expect(summary.weeksNeedingAttention).toBe(2)
  })

  it('judges only the weeks inside the horizon', () => {
    const weeks = [
      entry('2026-08-24', 'published', PUBLISHED_AT, [live({ shift_date: '2026-08-24' })], [
        snapshot({ shift_date: '2026-08-24' }),
      ]),
      entry('2026-08-31', 'published', PUBLISHED_AT, [live()], [snapshot()]),
      entry('2026-09-07', 'draft', null, [live({ id: 'shift-later', shift_date: '2026-09-07' })]),
    ]

    const inHorizon = summariseRotaReadiness(weeks, 2)
    expect(inHorizon.byWeek).toHaveLength(2)
    expect(inHorizon.weeksNeedingAttention).toBe(0)
    expect(inHorizon.totalUnpublished).toBe(0)
    expect(inHorizon.firstProblemWeekStart).toBeNull()

    const widened = summariseRotaReadiness(weeks, 3)
    expect(widened.byWeek).toHaveLength(3)
    expect(widened.weeksNeedingAttention).toBe(1)
    expect(widened.totalUnpublished).toBe(1)
    expect(widened.firstProblemWeekStart).toBe('2026-09-07')
  })

  it('returns an empty summary for a zero-week horizon', () => {
    const summary = summariseRotaReadiness([entry('2026-08-31', 'draft', null, [live()])], 0)

    expect(summary).toEqual({
      weeksNeedingAttention: 0,
      totalUnpublished: 0,
      firstProblemWeekStart: null,
      byWeek: [],
    })
  })

  it('totals unseen shifts across every week needing attention', () => {
    const summary = summariseRotaReadiness(
      [
        entry('2026-08-31', 'draft', null, [live(), live({ id: 'shift-2' })]),
        entry('2026-09-07', 'published', PUBLISHED_AT, [live({ id: 'shift-3', shift_date: '2026-09-07' })], []),
      ],
      4,
    )

    expect(summary.totalUnpublished).toBe(3)
    expect(summary.weeksNeedingAttention).toBe(2)
    expect(summary.firstProblemWeekStart).toBe('2026-08-31')
  })
})
