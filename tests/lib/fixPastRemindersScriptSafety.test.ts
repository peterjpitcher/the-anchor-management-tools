import { describe, expect, it } from 'vitest'
import {
  assertFixPastRemindersMutationAllowed,
  assertFixPastRemindersReminderLimit,
  assertFixPastRemindersRunEnabled,
  assertFixPastRemindersSmsJobLimit,
  readFixPastRemindersReminderLimit,
  readFixPastRemindersSmsJobLimit,
  resolveFixPastRemindersOperations
} from '@/lib/fix-past-reminders-script-safety'

describe('fix past reminders script safety', () => {
  it('blocks run when RUN_FIX_PAST_REMINDERS_MUTATION is missing', () => {
    const previous = process.env.RUN_FIX_PAST_REMINDERS_MUTATION
    delete process.env.RUN_FIX_PAST_REMINDERS_MUTATION

    expect(() => assertFixPastRemindersRunEnabled()).toThrow(
      'fix-past-reminders is in read-only mode. Set RUN_FIX_PAST_REMINDERS_MUTATION=true and ALLOW_FIX_PAST_REMINDERS_MUTATION=true to run mutations.'
    )

    if (previous === undefined) {
      delete process.env.RUN_FIX_PAST_REMINDERS_MUTATION
    } else {
      process.env.RUN_FIX_PAST_REMINDERS_MUTATION = previous
    }
  })

  it('blocks mutation when ALLOW_FIX_PAST_REMINDERS_MUTATION is missing', () => {
    const previous = process.env.ALLOW_FIX_PAST_REMINDERS_MUTATION
    delete process.env.ALLOW_FIX_PAST_REMINDERS_MUTATION

    expect(() => assertFixPastRemindersMutationAllowed()).toThrow(
      'fix-past-reminders blocked by safety guard. Set ALLOW_FIX_PAST_REMINDERS_MUTATION=true to run this mutation script.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_FIX_PAST_REMINDERS_MUTATION
    } else {
      process.env.ALLOW_FIX_PAST_REMINDERS_MUTATION = previous
    }
  })

  it('defaults to scanning both categories in dry-run mode', () => {
    expect(resolveFixPastRemindersOperations(['node', 'script'])).toEqual({
      cancelReminders: true,
      deletePendingSmsJobs: true
    })
  })

  it('requires explicit mutation operations when confirmed', () => {
    expect(() => resolveFixPastRemindersOperations(['node', 'script', '--confirm'])).toThrow(
      'fix-past-reminders blocked: choose at least one mutation operation (--cancel-reminders and/or --delete-pending-sms-jobs).'
    )
  })

  it('resolves requested mutation operations when confirmed', () => {
    expect(
      resolveFixPastRemindersOperations(['node', 'script', '--confirm', '--cancel-reminders'])
    ).toEqual({
      cancelReminders: true,
      deletePendingSmsJobs: false
    })

    expect(
      resolveFixPastRemindersOperations(['node', 'script', '--confirm', '--delete-pending-sms-jobs'])
    ).toEqual({
      cancelReminders: false,
      deletePendingSmsJobs: true
    })

    expect(
      resolveFixPastRemindersOperations([
        'node',
        'script',
        '--confirm',
        '--cancel-reminders',
        '--delete-pending-sms-jobs'
      ])
    ).toEqual({
      cancelReminders: true,
      deletePendingSmsJobs: true
    })
  })

  it('reads reminder limit from argv and env', () => {
    const previous = process.env.FIX_PAST_REMINDERS_REMINDER_LIMIT

    expect(readFixPastRemindersReminderLimit(['node', 'script', '--reminder-limit=12'])).toBe(12)
    expect(readFixPastRemindersReminderLimit(['node', 'script', '--reminder-limit', '13'])).toBe(13)
    expect(readFixPastRemindersReminderLimit(['node', 'script', '--reminder-limit', '0'])).toBeNull()

    process.env.FIX_PAST_REMINDERS_REMINDER_LIMIT = '21'
    expect(readFixPastRemindersReminderLimit(['node', 'script'])).toBe(21)

    if (previous === undefined) {
      delete process.env.FIX_PAST_REMINDERS_REMINDER_LIMIT
    } else {
      process.env.FIX_PAST_REMINDERS_REMINDER_LIMIT = previous
    }
  })

  it('reads SMS job limit from argv and env', () => {
    const previous = process.env.FIX_PAST_REMINDERS_JOB_LIMIT

    expect(readFixPastRemindersSmsJobLimit(['node', 'script', '--job-limit=17'])).toBe(17)
    expect(readFixPastRemindersSmsJobLimit(['node', 'script', '--job-limit', '18'])).toBe(18)
    expect(readFixPastRemindersSmsJobLimit(['node', 'script', '--job-limit', 'abc'])).toBeNull()

    process.env.FIX_PAST_REMINDERS_JOB_LIMIT = '40'
    expect(readFixPastRemindersSmsJobLimit(['node', 'script'])).toBe(40)

    if (previous === undefined) {
      delete process.env.FIX_PAST_REMINDERS_JOB_LIMIT
    } else {
      process.env.FIX_PAST_REMINDERS_JOB_LIMIT = previous
    }
  })

  it('enforces explicit capped limits for reminder cancellation and SMS job deletion', () => {
    expect(() => assertFixPastRemindersReminderLimit(0, 500)).toThrow(
      'fix-past-reminders blocked: reminder limit must be a positive integer.'
    )
    expect(() => assertFixPastRemindersReminderLimit(501, 500)).toThrow(
      'fix-past-reminders blocked: reminder limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertFixPastRemindersReminderLimit(10, 500)).not.toThrow()

    expect(() => assertFixPastRemindersSmsJobLimit(0, 500)).toThrow(
      'fix-past-reminders blocked: job limit must be a positive integer.'
    )
    expect(() => assertFixPastRemindersSmsJobLimit(501, 500)).toThrow(
      'fix-past-reminders blocked: job limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertFixPastRemindersSmsJobLimit(10, 500)).not.toThrow()
  })
})

