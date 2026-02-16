import { describe, expect, it } from 'vitest'
import {
  assertFinalizeEventRemindersJobLimit,
  assertFinalizeEventRemindersMutationAllowed,
  assertFinalizeEventRemindersReminderLimit,
  assertFinalizeEventRemindersRunEnabled,
  readFinalizeEventRemindersJobLimit,
  readFinalizeEventRemindersReminderLimit,
  resolveFinalizeEventRemindersOperations
} from '@/lib/finalize-event-reminders-script-safety'

describe('finalize event reminders script safety', () => {
  it('blocks run when RUN_FINALIZE_EVENT_REMINDERS_MUTATION is missing', () => {
    const previous = process.env.RUN_FINALIZE_EVENT_REMINDERS_MUTATION
    delete process.env.RUN_FINALIZE_EVENT_REMINDERS_MUTATION

    expect(() => assertFinalizeEventRemindersRunEnabled()).toThrow(
      'finalize-event-reminders is in read-only mode. Set RUN_FINALIZE_EVENT_REMINDERS_MUTATION=true and ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION=true to run mutations.'
    )

    if (previous === undefined) {
      delete process.env.RUN_FINALIZE_EVENT_REMINDERS_MUTATION
    } else {
      process.env.RUN_FINALIZE_EVENT_REMINDERS_MUTATION = previous
    }
  })

  it('blocks mutation when allow env vars are missing', () => {
    const previousAllow = process.env.ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION
    const previousLegacy = process.env.ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT
    delete process.env.ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION
    delete process.env.ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT

    expect(() => assertFinalizeEventRemindersMutationAllowed()).toThrow(
      'finalize-event-reminders blocked by safety guard. Set ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION=true to run this mutation script.'
    )

    if (previousAllow === undefined) {
      delete process.env.ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION
    } else {
      process.env.ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT
    } else {
      process.env.ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT = previousLegacy
    }
  })

  it('allows mutation when legacy allow flag is set', () => {
    const previousAllow = process.env.ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION
    const previousLegacy = process.env.ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT
    delete process.env.ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION
    process.env.ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT = 'true'

    expect(() => assertFinalizeEventRemindersMutationAllowed()).not.toThrow()

    if (previousAllow === undefined) {
      delete process.env.ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION
    } else {
      process.env.ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT
    } else {
      process.env.ALLOW_FINALIZE_EVENT_REMINDERS_SCRIPT = previousLegacy
    }
  })

  it('defaults to scanning both categories in dry-run mode', () => {
    expect(resolveFinalizeEventRemindersOperations(['node', 'script'])).toEqual({
      cancelReminders: true,
      cancelJobs: true
    })
  })

  it('requires explicit mutation operations when confirmed', () => {
    expect(() => resolveFinalizeEventRemindersOperations(['node', 'script', '--confirm'])).toThrow(
      'finalize-event-reminders blocked: choose at least one mutation operation (--cancel-reminders and/or --cancel-jobs).'
    )
  })

  it('resolves requested mutation operations when confirmed', () => {
    expect(
      resolveFinalizeEventRemindersOperations(['node', 'script', '--confirm', '--cancel-reminders'])
    ).toEqual({
      cancelReminders: true,
      cancelJobs: false
    })

    expect(
      resolveFinalizeEventRemindersOperations(['node', 'script', '--confirm', '--cancel-jobs'])
    ).toEqual({
      cancelReminders: false,
      cancelJobs: true
    })

    expect(
      resolveFinalizeEventRemindersOperations([
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
    const prevReminder = process.env.FINALIZE_EVENT_REMINDERS_REMINDER_LIMIT
    const prevJob = process.env.FINALIZE_EVENT_REMINDERS_JOB_LIMIT

    expect(readFinalizeEventRemindersReminderLimit(['node', 'script', '--reminder-limit=12'])).toBe(12)
    expect(readFinalizeEventRemindersReminderLimit(['node', 'script', '--reminder-limit', '13'])).toBe(13)
    expect(readFinalizeEventRemindersReminderLimit(['node', 'script', '--reminder-limit', '0'])).toBeNull()

    expect(readFinalizeEventRemindersJobLimit(['node', 'script', '--job-limit=17'])).toBe(17)
    expect(readFinalizeEventRemindersJobLimit(['node', 'script', '--job-limit', '18'])).toBe(18)
    expect(readFinalizeEventRemindersJobLimit(['node', 'script', '--job-limit', 'abc'])).toBeNull()

    process.env.FINALIZE_EVENT_REMINDERS_REMINDER_LIMIT = '21'
    process.env.FINALIZE_EVENT_REMINDERS_JOB_LIMIT = '22'
    expect(readFinalizeEventRemindersReminderLimit(['node', 'script'])).toBe(21)
    expect(readFinalizeEventRemindersJobLimit(['node', 'script'])).toBe(22)

    if (prevReminder === undefined) {
      delete process.env.FINALIZE_EVENT_REMINDERS_REMINDER_LIMIT
    } else {
      process.env.FINALIZE_EVENT_REMINDERS_REMINDER_LIMIT = prevReminder
    }

    if (prevJob === undefined) {
      delete process.env.FINALIZE_EVENT_REMINDERS_JOB_LIMIT
    } else {
      process.env.FINALIZE_EVENT_REMINDERS_JOB_LIMIT = prevJob
    }
  })

  it('enforces explicit capped limits for reminders and jobs', () => {
    expect(() => assertFinalizeEventRemindersReminderLimit(0, 500)).toThrow(
      'finalize-event-reminders blocked: reminder limit must be a positive integer.'
    )
    expect(() => assertFinalizeEventRemindersReminderLimit(501, 500)).toThrow(
      'finalize-event-reminders blocked: reminder limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertFinalizeEventRemindersReminderLimit(10, 500)).not.toThrow()

    expect(() => assertFinalizeEventRemindersJobLimit(0, 500)).toThrow(
      'finalize-event-reminders blocked: job limit must be a positive integer.'
    )
    expect(() => assertFinalizeEventRemindersJobLimit(501, 500)).toThrow(
      'finalize-event-reminders blocked: job limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertFinalizeEventRemindersJobLimit(10, 500)).not.toThrow()
  })
})

