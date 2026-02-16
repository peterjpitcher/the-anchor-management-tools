import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

export type PendingSmsJobForDelete = {
  id: string
  created_at: string | null
  payload: unknown
}

export function assertDeletePendingSmsMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'delete-pending-sms',
    envVar: 'ALLOW_DELETE_PENDING_SMS_SCRIPT'
  })
}

export function resolvePendingSmsJobsForDelete(params: {
  jobs: PendingSmsJobForDelete[] | null
  error: { message?: string } | null
}): PendingSmsJobForDelete[] {
  assertScriptQuerySucceeded({
    operation: 'Load pending SMS jobs',
    error: params.error,
    data: { ok: true }
  })

  return Array.isArray(params.jobs) ? params.jobs : []
}

export function assertDeletePendingSmsUpdateSucceeded(params: {
  error: { message?: string } | null
  updatedRows: Array<{ id?: string }> | null
  expectedCount: number
}): { updatedCount: number } {
  const { updatedCount } = assertScriptMutationSucceeded({
    operation: 'Cancel pending SMS jobs',
    error: params.error,
    updatedRows: params.updatedRows,
    allowZeroRows: params.expectedCount === 0
  })

  assertScriptExpectedRowCount({
    operation: 'Cancel pending SMS jobs',
    expected: params.expectedCount,
    actual: updatedCount
  })

  return { updatedCount }
}

export function assertDeletePendingSmsAuditPersisted(params: {
  error: { message?: string } | null
  insertedRows: Array<{ id?: string }> | null
}): void {
  assertDeletePendingSmsUpdateSucceeded({
    error: params.error,
    updatedRows: params.insertedRows,
    expectedCount: 1
  })
}
