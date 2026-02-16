import { describe, expect, it } from 'vitest'
import {
  assertClearReminderBacklogJobLimit,
  assertClearReminderBacklogMutationAllowed,
  assertClearReminderBacklogReminderLimit,
  assertClearReminderBacklogRunEnabled,
  readClearReminderBacklogJobLimit,
  readClearReminderBacklogReminderLimit,
  resolveClearReminderBacklogOperations
} from '@/lib/clear-reminder-backlog-script-safety'

describe('clear reminder backlog script safety', () => {
  it('blocks run when RUN_CLEAR_REMINDER_BACKLOG_MUTATION is missing', () => {
    const previous = process.env.RUN_CLEAR_REMINDER_BACKLOG_MUTATION
    delete process.env.RUN_CLEAR_REMINDER_BACKLOG_MUTATION

    expect(() => assertClearReminderBacklogRunEnabled()).toThrow(
      'clear-reminder-backlog is in read-only mode. Set RUN_CLEAR_REMINDER_BACKLOG_MUTATION=true and ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION=true to run mutations.'
    )

    if (previous === undefined) {
      delete process.env.RUN_CLEAR_REMINDER_BACKLOG_MUTATION
    } else {
      process.env.RUN_CLEAR_REMINDER_BACKLOG_MUTATION = previous
    }
  })

  it('blocks mutation when allow env vars are missing', () => {
    const previousAllow = process.env.ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION
    const previousLegacy = process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT
    delete process.env.ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION
    delete process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT

    expect(() => assertClearReminderBacklogMutationAllowed()).toThrow(
      'clear-reminder-backlog blocked by safety guard. Set ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION=true to run this mutation script.'
    )

    if (previousAllow === undefined) {
      delete process.env.ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION
    } else {
      process.env.ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT
    } else {
      process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT = previousLegacy
    }
  })

  it('allows mutation when legacy allow flag is set', () => {
    const previousAllow = process.env.ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION
    const previousLegacy = process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT
    delete process.env.ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION
    process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT = 'true'

    expect(() => assertClearReminderBacklogMutationAllowed()).not.toThrow()

    if (previousAllow === undefined) {
      delete process.env.ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION
    } else {
      process.env.ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT
    } else {
      process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT = previousLegacy
    }
  })

  it('defaults to scanning both categories in dry-run mode', () => {
    expect(resolveClearReminderBacklogOperations(['node', 'script'])).toEqual({
      cancelReminders: true,
      cancelJobs: true
    })
  })

  it('requires explicit mutation operations when confirmed', () => {
    expect(() => resolveClearReminderBacklogOperations(['node', 'script', '--confirm'])).toThrow(
      'clear-reminder-backlog blocked: choose at least one mutation operation (--cancel-reminders and/or --cancel-jobs).'
    )
  })

  it('resolves requested mutation operations when confirmed', () => {
    expect(
      resolveClearReminderBacklogOperations(['node', 'script', '--confirm', '--cancel-reminders'])
    ).toEqual({
      cancelReminders: true,
      cancelJobs: false
    })

    expect(
      resolveClearReminderBacklogOperations(['node', 'script', '--confirm', '--cancel-jobs'])
    ).toEqual({
      cancelReminders: false,
      cancelJobs: true
    })

    expect(
      resolveClearReminderBacklogOperations([
        'node',
        'script',
        '--confirm',
        '--cancel-reminders',
        '--cancel-jobs'
      ])
    ).toEqual({
      cancelReminders: true,
      cancelJobs: true
    })
  })

  it('reads reminder and job limits from argv and env', () => {
    const prevReminder = process.env.CLEAR_REMINDER_BACKLOG_REMINDER_LIMIT
    const prevJob = process.env.CLEAR_REMINDER_BACKLOG_JOB_LIMIT

    expect(readClearReminderBacklogReminderLimit(['node', 'script', '--reminder-limit=12'])).toBe(12)
    expect(readClearReminderBacklogReminderLimit(['node', 'script', '--reminder-limit', '13'])).toBe(13)
    expect(readClearReminderBacklogReminderLimit(['node', 'script', '--reminder-limit', '0'])).toBeNull()

    expect(readClearReminderBacklogJobLimit(['node', 'script', '--job-limit=17'])).toBe(17)
    expect(readClearReminderBacklogJobLimit(['node', 'script', '--job-limit', '18'])).toBe(18)
    expect(readClearReminderBacklogJobLimit(['node', 'script', '--job-limit', 'abc'])).toBeNull()

    process.env.CLEAR_REMINDER_BACKLOG_REMINDER_LIMIT = '21'
    process.env.CLEAR_REMINDER_BACKLOG_JOB_LIMIT = '22'
    expect(readClearReminderBacklogReminderLimit(['node', 'script'])).toBe(21)
    expect(readClearReminderBacklogJobLimit(['node', 'script'])).toBe(22)

    if (prevReminder === undefined) {
      delete process.env.CLEAR_REMINDER_BACKLOG_REMINDER_LIMIT
    } else {
      process.env.CLEAR_REMINDER_BACKLOG_REMINDER_LIMIT = prevReminder
    }

    if (prevJob === undefined) {
      delete process.env.CLEAR_REMINDER_BACKLOG_JOB_LIMIT
    } else {
      process.env.CLEAR_REMINDER_BACKLOG_JOB_LIMIT = prevJob
    }
  })

  it('enforces explicit capped limits for reminders and jobs', () => {
    expect(() => assertClearReminderBacklogReminderLimit(0, 500)).toThrow(
      'clear-reminder-backlog blocked: reminder limit must be a positive integer.'
    )
    expect(() => assertClearReminderBacklogReminderLimit(501, 500)).toThrow(
      'clear-reminder-backlog blocked: reminder limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertClearReminderBacklogReminderLimit(10, 500)).not.toThrow()

    expect(() => assertClearReminderBacklogJobLimit(0, 500)).toThrow(
      'clear-reminder-backlog blocked: job limit must be a positive integer.'
    )
    expect(() => assertClearReminderBacklogJobLimit(501, 500)).toThrow(
      'clear-reminder-backlog blocked: job limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertClearReminderBacklogJobLimit(10, 500)).not.toThrow()
  })
})

