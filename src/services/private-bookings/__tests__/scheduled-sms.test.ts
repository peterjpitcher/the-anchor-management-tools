import { describe, it, expect } from 'vitest'
import {
  classifyBalanceReminderWindow,
  classifyDepositReminderWindow,
  reminderDedupDateFilter,
} from '../scheduled-sms'

// These classifiers are the single source of truth for the reminder windows,
// imported by BOTH the private-booking-monitor cron and the Communications-tab
// preview — these tests therefore pin the alignment between the two
// (discovery 2026-07-08: preview advertised 4-10/2-3/0-1 deposit windows
// while the cron actually sent at 4-7/2-3/1).

describe('classifyDepositReminderWindow', () => {
  it('should match the cron send windows exactly (7day: 4-7, 3day: 2-3, 1day: 1)', () => {
    expect(classifyDepositReminderWindow(7)).toBe('deposit_reminder_7day')
    expect(classifyDepositReminderWindow(6)).toBe('deposit_reminder_7day')
    expect(classifyDepositReminderWindow(5)).toBe('deposit_reminder_7day')
    expect(classifyDepositReminderWindow(4)).toBe('deposit_reminder_7day')
    expect(classifyDepositReminderWindow(3)).toBe('deposit_reminder_3day')
    expect(classifyDepositReminderWindow(2)).toBe('deposit_reminder_3day')
    expect(classifyDepositReminderWindow(1)).toBe('deposit_reminder_1day')
  })

  it('should not fire outside the windows (old preview showed 8-10 and day 0)', () => {
    // 8-10 days out: the old preview window over-advertised these.
    expect(classifyDepositReminderWindow(8)).toBeNull()
    expect(classifyDepositReminderWindow(9)).toBeNull()
    expect(classifyDepositReminderWindow(10)).toBeNull()
    // Day 0: expiry itself belongs to the expire-holds cron, not a reminder.
    expect(classifyDepositReminderWindow(0)).toBeNull()
    // Already expired.
    expect(classifyDepositReminderWindow(-1)).toBeNull()
  })
})

describe('classifyBalanceReminderWindow', () => {
  it('should match the SOP §13 schedule (7/2/1 days before the deadline and on the day)', () => {
    expect(classifyBalanceReminderWindow(7)).toBe('balance_reminder_21day')
    expect(classifyBalanceReminderWindow(5)).toBe('balance_reminder_21day')
    expect(classifyBalanceReminderWindow(3)).toBe('balance_reminder_21day')
    expect(classifyBalanceReminderWindow(2)).toBe('balance_reminder_16day')
    expect(classifyBalanceReminderWindow(1)).toBe('balance_reminder_15day')
    expect(classifyBalanceReminderWindow(0)).toBe('balance_reminder_due')
  })

  it('should never chase past-due balances and ignore deadlines beyond 7 days', () => {
    expect(classifyBalanceReminderWindow(-1)).toBeNull()
    expect(classifyBalanceReminderWindow(-30)).toBeNull()
    expect(classifyBalanceReminderWindow(8)).toBeNull()
  })
})

describe('reminderDedupDateFilter', () => {
  /**
   * Minimal evaluator for the two-clause PostgREST `or=` filter the helper
   * emits, mirroring jsonb semantics: `metadata->>key` yields SQL NULL when
   * the key is absent (or the metadata is empty `{}` / NULL), so `.is.null`
   * matches exactly those legacy rows.
   */
  function priorRowBlocks(
    filter: string,
    metadata: Record<string, unknown> | null,
  ): boolean {
    return filter.split(',').some((clause) => {
      const nullMatch = clause.match(/^metadata->>(\w+)\.is\.null$/)
      if (nullMatch) {
        return metadata?.[nullMatch[1]] == null
      }
      const eqMatch = clause.match(/^metadata->>(\w+)\.eq\.(.+)$/)
      if (eqMatch) {
        return metadata?.[eqMatch[1]] === eqMatch[2]
      }
      throw new Error(`Unrecognised filter clause: ${clause}`)
    })
  }

  it('should emit the PostgREST or-filter keyed to the metadata field and window key', () => {
    expect(reminderDedupDateFilter('balance_due_date', '2026-07-05')).toBe(
      'metadata->>balance_due_date.is.null,metadata->>balance_due_date.eq.2026-07-05',
    )
    expect(reminderDedupDateFilter('hold_expiry_date', '2026-07-19')).toBe(
      'metadata->>hold_expiry_date.is.null,metadata->>hold_expiry_date.eq.2026-07-19',
    )
  })

  it('should block when a prior row was armed for the SAME deadline', () => {
    const filter = reminderDedupDateFilter('balance_due_date', '2026-07-05')
    expect(priorRowBlocks(filter, { balance_due_date: '2026-07-05' })).toBe(true)
  })

  it('should re-arm when the deadline has moved (prior row keyed to a different date)', () => {
    // Paula's case: reminder sent against the 12th, deadline corrected to the
    // 5th — the customer must get a reminder carrying the NEW date.
    const filter = reminderDedupDateFilter('balance_due_date', '2026-07-05')
    expect(priorRowBlocks(filter, { balance_due_date: '2026-07-12' })).toBe(false)
  })

  it('should keep blocking on legacy rows with no keyed date (no double-send on deploy)', () => {
    const filter = reminderDedupDateFilter('balance_due_date', '2026-07-05')
    // Queue default is '{}' — key absent.
    expect(priorRowBlocks(filter, {})).toBe(true)
    // Defensive: NULL metadata behaves the same.
    expect(priorRowBlocks(filter, null)).toBe(true)
    // Rows keyed by other writers for other purposes still count as legacy.
    expect(priorRowBlocks(filter, { queue_job_id: 'abc' })).toBe(true)
  })

  it('should apply the same semantics to hold-expiry keyed deposit reminders', () => {
    const filter = reminderDedupDateFilter('hold_expiry_date', '2026-07-19')
    expect(priorRowBlocks(filter, { hold_expiry_date: '2026-07-19' })).toBe(true)
    expect(priorRowBlocks(filter, { hold_expiry_date: '2026-07-26' })).toBe(false)
    expect(priorRowBlocks(filter, {})).toBe(true)
  })
})
