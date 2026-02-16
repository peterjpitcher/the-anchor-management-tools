import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'

export type CronRunPersistResult = 'updated' | 'missing' | 'error'
export type CronRunRecoverResult = 'acquired' | 'already_running' | 'already_completed' | 'missing'

type PersistCronRunResultInput = {
  runId: string
  status: 'completed' | 'failed'
  errorMessage?: string
  context: string
}

export async function persistCronRunResult(
  supabase: ReturnType<typeof createAdminClient>,
  input: PersistCronRunResultInput
): Promise<CronRunPersistResult> {
  const payload: Record<string, unknown> = {
    status: input.status,
    finished_at: new Date().toISOString()
  }

  if (input.errorMessage) {
    payload.error_message = input.errorMessage.slice(0, 2000)
  }

  const { data, error } = await supabase
    .from('cron_job_runs')
    .update(payload)
    .eq('id', input.runId)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.error(`${input.context}: failed to persist cron run result`, {
      metadata: {
        runId: input.runId,
        status: input.status,
        error: error.message
      }
    })
    return 'error'
  }

  if (!data) {
    logger.warn(`${input.context}: cron run result update affected no rows`, {
      metadata: {
        runId: input.runId,
        status: input.status
      }
    })
    return 'missing'
  }

  return 'updated'
}

type RecoverCronRunLockInput = {
  jobName: string
  runKey: string
  nowIso: string
  context: string
  isRunStale: (startedAt: string | null | undefined) => boolean
}

type RecoverCronRunLockOutput = {
  result: CronRunRecoverResult
  runId: string | null
}

export async function recoverCronRunLock(
  supabase: ReturnType<typeof createAdminClient>,
  input: RecoverCronRunLockInput
): Promise<RecoverCronRunLockOutput> {
  const { data: inserted, error: insertError } = await supabase
    .from('cron_job_runs')
    .insert({
      job_name: input.jobName,
      run_key: input.runKey,
      status: 'running',
      started_at: input.nowIso
    })
    .select('id')
    .single()

  if (inserted?.id) {
    return { result: 'acquired', runId: inserted.id }
  }

  const insertPgError = insertError as { code?: string; message?: string } | null
  if (insertPgError?.code !== '23505') {
    throw insertError ?? new Error(`${input.context}: failed to recover cron run lock`)
  }

  const { data: existing, error: fetchError } = await supabase
    .from('cron_job_runs')
    .select('id, status, started_at')
    .eq('job_name', input.jobName)
    .eq('run_key', input.runKey)
    .maybeSingle()

  if (fetchError) {
    throw fetchError
  }

  if (!existing) {
    logger.warn(`${input.context}: cron run lock recovery found no existing row`, {
      metadata: {
        jobName: input.jobName,
        runKey: input.runKey
      }
    })
    return { result: 'missing', runId: null }
  }

  if (existing.status === 'completed') {
    return { result: 'already_completed', runId: existing.id }
  }

  if (existing.status === 'running' && !input.isRunStale(existing.started_at)) {
    return { result: 'already_running', runId: existing.id }
  }

  return { result: 'acquired', runId: existing.id }
}
