import { describe, expect, it } from 'vitest'
import {
  assertMigrateInviteRemindersBookingLimit,
  assertMigrateInviteRemindersMutationAllowed,
  assertMigrateInviteRemindersRunEnabled,
  readMigrateInviteRemindersBookingLimit,
  resolveMigrateInviteRemindersOperations
} from '@/lib/migrate-invite-reminders-script-safety'

describe('migrate invite reminders script safety', () => {
  it('blocks run when RUN_MIGRATE_INVITE_REMINDERS_MUTATION is missing', () => {
    const previous = process.env.RUN_MIGRATE_INVITE_REMINDERS_MUTATION
    delete process.env.RUN_MIGRATE_INVITE_REMINDERS_MUTATION

    expect(() => assertMigrateInviteRemindersRunEnabled()).toThrow(
      'migrate-invite-reminders is in read-only mode. Set RUN_MIGRATE_INVITE_REMINDERS_MUTATION=true and ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION=true to run mutations.'
    )

    if (previous === undefined) {
      delete process.env.RUN_MIGRATE_INVITE_REMINDERS_MUTATION
    } else {
      process.env.RUN_MIGRATE_INVITE_REMINDERS_MUTATION = previous
    }
  })

  it('blocks mutation when allow env vars are missing', () => {
    const previousAllow = process.env.ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION
    const previousLegacy = process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT
    delete process.env.ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION
    delete process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT

    expect(() => assertMigrateInviteRemindersMutationAllowed()).toThrow(
      'migrate-invite-reminders blocked by safety guard. Set ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION=true to run this mutation script.'
    )

    if (previousAllow === undefined) {
      delete process.env.ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION
    } else {
      process.env.ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT
    } else {
      process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT = previousLegacy
    }
  })

  it('allows mutation when legacy allow flag is set', () => {
    const previousAllow = process.env.ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION
    const previousLegacy = process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT
    delete process.env.ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION
    process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT = 'true'

    expect(() => assertMigrateInviteRemindersMutationAllowed()).not.toThrow()

    if (previousAllow === undefined) {
      delete process.env.ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION
    } else {
      process.env.ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT
    } else {
      process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT = previousLegacy
    }
  })

  it('defaults to scanning both categories in dry-run mode', () => {
    expect(resolveMigrateInviteRemindersOperations(['node', 'script'])).toEqual({
      deleteLegacyReminders: true,
      rescheduleReminders: true
    })
  })

  it('requires explicit mutation operations when confirmed', () => {
    expect(() => resolveMigrateInviteRemindersOperations(['node', 'script', '--confirm'])).toThrow(
      'migrate-invite-reminders blocked: choose at least one mutation operation (--delete-legacy-reminders and/or --reschedule).'
    )
  })

  it('blocks reschedule without deletion when confirmed', () => {
    expect(() =>
      resolveMigrateInviteRemindersOperations(['node', 'script', '--confirm', '--reschedule'])
    ).toThrow(
      'migrate-invite-reminders blocked: --reschedule requires --delete-legacy-reminders to avoid duplicating reminders.'
    )
  })

  it('resolves requested mutation operations when confirmed', () => {
    expect(
      resolveMigrateInviteRemindersOperations(['node', 'script', '--confirm', '--delete-legacy-reminders'])
    ).toEqual({
      deleteLegacyReminders: true,
      rescheduleReminders: false
    })

    expect(
      resolveMigrateInviteRemindersOperations([
        'node',
        'script',
        '--confirm',
        '--delete-legacy-reminders',
        '--reschedule'
      ])
    ).toEqual({
      deleteLegacyReminders: true,
      rescheduleReminders: true
    })
  })

  it('reads booking limit from argv and env', () => {
    const previous = process.env.MIGRATE_INVITE_REMINDERS_BOOKING_LIMIT

    expect(readMigrateInviteRemindersBookingLimit(['node', 'script', '--booking-limit=12'])).toBe(12)
    expect(readMigrateInviteRemindersBookingLimit(['node', 'script', '--booking-limit', '13'])).toBe(13)
    expect(readMigrateInviteRemindersBookingLimit(['node', 'script', '--booking-limit', '0'])).toBeNull()

    process.env.MIGRATE_INVITE_REMINDERS_BOOKING_LIMIT = '21'
    expect(readMigrateInviteRemindersBookingLimit(['node', 'script'])).toBe(21)

    if (previous === undefined) {
      delete process.env.MIGRATE_INVITE_REMINDERS_BOOKING_LIMIT
    } else {
      process.env.MIGRATE_INVITE_REMINDERS_BOOKING_LIMIT = previous
    }
  })

  it('enforces explicit capped limits for booking batches', () => {
    expect(() => assertMigrateInviteRemindersBookingLimit(0, 500)).toThrow(
      'migrate-invite-reminders blocked: booking limit must be a positive integer.'
    )
    expect(() => assertMigrateInviteRemindersBookingLimit(501, 500)).toThrow(
      'migrate-invite-reminders blocked: booking limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertMigrateInviteRemindersBookingLimit(10, 500)).not.toThrow()
  })
})

