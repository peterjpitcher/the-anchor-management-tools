import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function isClearStuckJobsRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_CLEAR_STUCK_JOBS_MUTATION)
}

export function assertClearStuckJobsRunEnabled(): void {
  if (isClearStuckJobsRunEnabled()) {
    return
  }

  throw new Error(
    'clear-stuck-jobs is in read-only mode. Set RUN_CLEAR_STUCK_JOBS_MUTATION=true and ALLOW_CLEAR_STUCK_JOBS_MUTATION=true to run mutations.'
  )
}

export function assertClearStuckJobsMutationAllowed(): void {
  // Backwards-compatible allow flag for older usages.
  if (isTruthyEnv(process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT)) {
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'clear-stuck-jobs',
    envVar: 'ALLOW_CLEAR_STUCK_JOBS_MUTATION'
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

export function readClearStuckJobsStaleLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--stale-limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--stale-limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.CLEAR_STUCK_JOBS_STALE_LIMIT)
}

export function readClearStuckJobsPendingSmsJobLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--pending-limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--pending-limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.CLEAR_STUCK_JOBS_PENDING_LIMIT)
}

export function assertClearStuckJobsStaleLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('clear-stuck-jobs blocked: stale limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `clear-stuck-jobs blocked: stale limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function assertClearStuckJobsPendingSmsJobLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('clear-stuck-jobs blocked: pending limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `clear-stuck-jobs blocked: pending limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function resolveClearStuckJobsOperations(argv: string[] = process.argv): {
  failStaleProcessing: boolean
  deletePendingSmsJobs: boolean
} {
  const confirm = argv.includes('--confirm')
  const failStaleProcessing = argv.includes('--fail-stale-processing')
  const deletePendingSmsJobs = argv.includes('--delete-pending-sms-jobs')

  if (!confirm) {
    // Dry-run defaults to scanning both categories.
    return { failStaleProcessing: true, deletePendingSmsJobs: true }
  }

  if (!failStaleProcessing && !deletePendingSmsJobs) {
    throw new Error(
      'clear-stuck-jobs blocked: choose at least one mutation operation (--fail-stale-processing and/or --delete-pending-sms-jobs).'
    )
  }

  return { failStaleProcessing, deletePendingSmsJobs }
}

