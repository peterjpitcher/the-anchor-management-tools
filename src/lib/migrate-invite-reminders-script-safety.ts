import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function isMigrateInviteRemindersRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_MIGRATE_INVITE_REMINDERS_MUTATION)
}

export function assertMigrateInviteRemindersRunEnabled(): void {
  if (isMigrateInviteRemindersRunEnabled()) {
    return
  }

  throw new Error(
    'migrate-invite-reminders is in read-only mode. Set RUN_MIGRATE_INVITE_REMINDERS_MUTATION=true and ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION=true to run mutations.'
  )
}

export function assertMigrateInviteRemindersMutationAllowed(): void {
  // Backwards-compatible allow flag for older usages.
  if (isTruthyEnv(process.env.ALLOW_MIGRATE_INVITE_REMINDERS_SCRIPT)) {
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'migrate-invite-reminders',
    envVar: 'ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION'
  })
}

function parseOptionalPositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function readMigrateInviteRemindersBookingLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--booking-limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--booking-limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.MIGRATE_INVITE_REMINDERS_BOOKING_LIMIT)
}

export function assertMigrateInviteRemindersBookingLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('migrate-invite-reminders blocked: booking limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `migrate-invite-reminders blocked: booking limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function resolveMigrateInviteRemindersOperations(argv: string[] = process.argv): {
  deleteLegacyReminders: boolean
  rescheduleReminders: boolean
} {
  const confirm = argv.includes('--confirm')
  const deleteLegacyReminders = argv.includes('--delete-legacy-reminders')
  const rescheduleReminders = argv.includes('--reschedule')

  if (!confirm) {
    // Dry-run defaults to scanning both categories.
    return { deleteLegacyReminders: true, rescheduleReminders: true }
  }

  if (!deleteLegacyReminders && !rescheduleReminders) {
    throw new Error(
      'migrate-invite-reminders blocked: choose at least one mutation operation (--delete-legacy-reminders and/or --reschedule).'
    )
  }

  if (rescheduleReminders && !deleteLegacyReminders) {
    throw new Error(
      'migrate-invite-reminders blocked: --reschedule requires --delete-legacy-reminders to avoid duplicating reminders.'
    )
  }

  return { deleteLegacyReminders, rescheduleReminders }
}
