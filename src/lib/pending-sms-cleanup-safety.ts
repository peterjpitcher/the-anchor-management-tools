import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

export function assertDeleteAllPendingSmsMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'delete-all-pending-sms',
    envVar: 'ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT'
  })
}

export function resolveDeleteAllPendingSmsCount(params: {
  count: number | null
  error: { message?: string } | null
}): number {
  assertScriptQuerySucceeded({
    operation: 'Load pending SMS job count',
    error: params.error,
    data: { ok: true }
  })

  return Math.max(0, params.count ?? 0)
}

export function assertDeleteAllPendingSmsUpdateSucceeded(params: {
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

export function assertDeleteAllPendingSmsCompletedWithoutFailures(params: {
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: 'delete-all-pending-sms',
    failureCount: params.failureCount,
    failures: params.failures
  })
}
