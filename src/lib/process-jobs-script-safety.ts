import {
  assertScriptMutationAllowed,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

type PendingJobRow = {
  id: string
  type: string
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function assertProcessJobsMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'process-jobs',
    envVar: 'ALLOW_PROCESS_JOBS_MUTATION'
  })
}

export function assertProcessJobsRunEnabled(): void {
  if (isTruthyEnv(process.env.RUN_PROCESS_JOBS_MUTATION)) {
    return
  }

  throw new Error(
    'process-jobs is in read-only mode. Set RUN_PROCESS_JOBS_MUTATION=true and ALLOW_PROCESS_JOBS_MUTATION=true to process jobs.'
  )
}

export function resolveProcessJobsBatchSize(raw: string | undefined): number {
  if (!raw || raw.trim().length === 0) {
    return 5
  }

  const trimmed = raw.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(
      `Invalid process-jobs batch size "${raw}". Provide an integer between 1 and 100.`
    )
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error(
      `Invalid process-jobs batch size "${raw}". Provide an integer between 1 and 100.`
    )
  }

  return parsed
}

export function resolveProcessJobsPendingRows(params: {
  operation: string
  rows: PendingJobRow[] | null
  error: { message?: string } | null
}): PendingJobRow[] {
  assertScriptQuerySucceeded({
    operation: params.operation,
    error: params.error,
    data: { ok: true }
  })

  return Array.isArray(params.rows) ? params.rows : []
}

export function assertProcessJobsSendTypesAllowed(rows: PendingJobRow[]): void {
  const sendTypeJobs = rows.filter(
    (row) => row.type === 'send_sms' || row.type === 'send_bulk_sms'
  )

  if (sendTypeJobs.length === 0) {
    return
  }

  if (isTruthyEnv(process.env.ALLOW_PROCESS_JOBS_SEND_TYPES)) {
    return
  }

  const preview = sendTypeJobs
    .slice(0, 3)
    .map((row) => `${row.type}:${row.id}`)
    .join(', ')

  throw new Error(
    `process-jobs blocked by send-job safety guard. Pending send jobs detected (${sendTypeJobs.length}; ${preview}). Set ALLOW_PROCESS_JOBS_SEND_TYPES=true to process send jobs.`
  )
}
