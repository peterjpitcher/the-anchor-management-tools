import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function isFixPastRemindersRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_FIX_PAST_REMINDERS_MUTATION)
}

export function assertFixPastRemindersRunEnabled(): void {
  if (isFixPastRemindersRunEnabled()) {
    return
  }

  throw new Error(
    'fix-past-reminders is in read-only mode. Set RUN_FIX_PAST_REMINDERS_MUTATION=true and ALLOW_FIX_PAST_REMINDERS_MUTATION=true to run mutations.'
  )
}

export function assertFixPastRemindersMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'fix-past-reminders',
    envVar: 'ALLOW_FIX_PAST_REMINDERS_MUTATION'
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

export function readFixPastRemindersReminderLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--reminder-limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--reminder-limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.FIX_PAST_REMINDERS_REMINDER_LIMIT)
}

export function readFixPastRemindersSmsJobLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--job-limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--job-limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.FIX_PAST_REMINDERS_JOB_LIMIT)
}

export function assertFixPastRemindersReminderLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(
      'fix-past-reminders blocked: reminder limit must be a positive integer.'
    )
  }

  if (limit > max) {
    throw new Error(
      `fix-past-reminders blocked: reminder limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function assertFixPastRemindersSmsJobLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(
      'fix-past-reminders blocked: job limit must be a positive integer.'
    )
  }

  if (limit > max) {
    throw new Error(
      `fix-past-reminders blocked: job limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function resolveFixPastRemindersOperations(argv: string[] = process.argv): {
  cancelReminders: boolean
  deletePendingSmsJobs: boolean
} {
  const confirm = argv.includes('--confirm')
  const cancelReminders = argv.includes('--cancel-reminders')
  const deletePendingSmsJobs = argv.includes('--delete-pending-sms-jobs')

  if (!confirm) {
    // Dry-run defaults to scanning both categories.
    return { cancelReminders: true, deletePendingSmsJobs: true }
  }

  if (!cancelReminders && !deletePendingSmsJobs) {
    throw new Error(
      'fix-past-reminders blocked: choose at least one mutation operation (--cancel-reminders and/or --delete-pending-sms-jobs).'
    )
  }

  return { cancelReminders, deletePendingSmsJobs }
}

