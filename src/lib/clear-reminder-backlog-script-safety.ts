import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function isClearReminderBacklogRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_CLEAR_REMINDER_BACKLOG_MUTATION)
}

export function assertClearReminderBacklogRunEnabled(): void {
  if (isClearReminderBacklogRunEnabled()) {
    return
  }

  throw new Error(
    'clear-reminder-backlog is in read-only mode. Set RUN_CLEAR_REMINDER_BACKLOG_MUTATION=true and ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION=true to run mutations.'
  )
}

export function assertClearReminderBacklogMutationAllowed(): void {
  // Backwards-compatible allow flag for older usages.
  if (isTruthyEnv(process.env.ALLOW_CLEAR_REMINDER_BACKLOG_SCRIPT)) {
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'clear-reminder-backlog',
    envVar: 'ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION'
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

export function readClearReminderBacklogReminderLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--reminder-limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--reminder-limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.CLEAR_REMINDER_BACKLOG_REMINDER_LIMIT)
}

export function readClearReminderBacklogJobLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--job-limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--job-limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.CLEAR_REMINDER_BACKLOG_JOB_LIMIT)
}

export function assertClearReminderBacklogReminderLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('clear-reminder-backlog blocked: reminder limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `clear-reminder-backlog blocked: reminder limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function assertClearReminderBacklogJobLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('clear-reminder-backlog blocked: job limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `clear-reminder-backlog blocked: job limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function resolveClearReminderBacklogOperations(argv: string[] = process.argv): {
  cancelReminders: boolean
  cancelJobs: boolean
} {
  const confirm = argv.includes('--confirm')
  const cancelReminders = argv.includes('--cancel-reminders')
  const cancelJobs = argv.includes('--cancel-jobs')

  if (!confirm) {
    // Dry-run defaults to scanning both categories.
    return { cancelReminders: true, cancelJobs: true }
  }

  if (!cancelReminders && !cancelJobs) {
    throw new Error(
      'clear-reminder-backlog blocked: choose at least one mutation operation (--cancel-reminders and/or --cancel-jobs).'
    )
  }

  return { cancelReminders, cancelJobs }
}

