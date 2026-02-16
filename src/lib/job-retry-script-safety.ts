import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const HARD_CAP = 500

type JobRow = {
  id: string
  type?: string
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=')[1] ?? null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    return argv[idx + 1] ?? null
  }

  return null
}

export function isJobRetryMutationRunEnabled(argv: string[] = process.argv): boolean {
  return (
    argv.includes('--confirm') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(process.env.RUN_JOB_RETRY_MUTATION_SCRIPT)
  )
}

export function assertJobRetryMutationAllowed(scriptName: 'reset-jobs' | 'retry-failed-jobs'): void {
  assertScriptMutationAllowed({
    scriptName,
    envVar: 'ALLOW_JOB_RETRY_MUTATION_SCRIPT'
  })
}

export function resolveJobRetryLimit(argv: string[] = process.argv): number | null {
  const raw = readOptionalFlagValue(argv, '--limit')
  if (!raw) {
    return null
  }

  const trimmed = raw.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid --limit: ${raw}`)
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit: ${raw}`)
  }

  if (parsed > HARD_CAP) {
    throw new Error(`--limit exceeds hard cap (max ${HARD_CAP})`)
  }

  return parsed
}

export function assertJobRetrySendTypesAllowed(scriptName: 'reset-jobs', rows: JobRow[]): void {
  const sendTypeJobs = rows.filter(
    (row) => row.type === 'send_sms' || row.type === 'send_bulk_sms'
  )

  if (sendTypeJobs.length === 0) {
    return
  }

  if (isTruthyEnv(process.env.ALLOW_JOB_RETRY_SEND_TYPES)) {
    return
  }

  const preview = sendTypeJobs
    .slice(0, 3)
    .map((row) => `${row.type}:${row.id}`)
    .join(', ')

  throw new Error(
    `${scriptName} blocked by send-job safety guard. Selected send jobs detected (${sendTypeJobs.length}; ${preview}). Set ALLOW_JOB_RETRY_SEND_TYPES=true to include send jobs.`
  )
}

export function resolveJobRetryRows(params: {
  operation: string
  rows: JobRow[] | null
  error: { message?: string } | null
}): JobRow[] {
  assertScriptQuerySucceeded({
    operation: params.operation,
    error: params.error,
    data: { ok: true }
  })

  return Array.isArray(params.rows) ? params.rows : []
}

export function assertJobRetryMutationSucceeded(params: {
  operation: string
  error: { message?: string } | null
  updatedRows: Array<{ id?: string }> | null
  expectedCount: number
}): { updatedCount: number } {
  const { updatedCount } = assertScriptMutationSucceeded({
    operation: params.operation,
    error: params.error,
    updatedRows: params.updatedRows,
    allowZeroRows: params.expectedCount === 0
  })

  assertScriptExpectedRowCount({
    operation: params.operation,
    expected: params.expectedCount,
    actual: updatedCount
  })

  return { updatedCount }
}
