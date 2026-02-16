const DEFAULT_STALE_RUNTIME_MS = 60 * 1000

export type StuckProcessingJob = {
  id: string
  started_at: string | null
  created_at: string | null
}

type SelectStaleProcessingJobsParams = {
  jobs: StuckProcessingJob[]
  nowMs?: number
  staleRuntimeMs?: number
}

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function selectStaleProcessingJobIds(
  params: SelectStaleProcessingJobsParams
): {
  staleJobIds: string[]
  invalidTimingJobIds: string[]
} {
  const nowMs = params.nowMs ?? Date.now()
  const staleRuntimeMs = params.staleRuntimeMs ?? DEFAULT_STALE_RUNTIME_MS
  const staleJobIds: string[] = []
  const invalidTimingJobIds: string[] = []

  for (const job of params.jobs) {
    const startedAtMs = parseIsoTimestamp(job.started_at)
    const createdAtMs = parseIsoTimestamp(job.created_at)
    const referenceMs = startedAtMs ?? createdAtMs

    if (referenceMs === null) {
      invalidTimingJobIds.push(job.id)
      continue
    }

    if (nowMs - referenceMs > staleRuntimeMs) {
      staleJobIds.push(job.id)
    }
  }

  return { staleJobIds, invalidTimingJobIds }
}

export function assertNoInvalidStuckJobTimings(invalidTimingJobIds: string[]): void {
  if (invalidTimingJobIds.length === 0) {
    return
  }

  throw new Error(
    `Cannot safely evaluate processing jobs because ${invalidTimingJobIds.length} row(s) have invalid started_at/created_at values: ${invalidTimingJobIds.join(', ')}`
  )
}
