import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

export function assertDeleteAllQueuedMessagesMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'delete-all-queued-messages',
    envVar: 'ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT'
  })
}

export function resolveQueuedMessagesCleanupRows<T>(params: {
  operation: string
  rows: T[] | null
  error: { message?: string } | null
}): T[] {
  assertScriptQuerySucceeded({
    operation: params.operation,
    error: params.error,
    data: { ok: true }
  })

  return Array.isArray(params.rows) ? params.rows : []
}

export function assertQueuedMessagesCleanupDeleteSucceeded(params: {
  operation: string
  error: { message?: string } | null
  deletedRows: Array<{ id?: string }> | null
  expectedCount: number
}): { deletedCount: number } {
  const { updatedCount } = assertScriptMutationSucceeded({
    operation: params.operation,
    error: params.error,
    updatedRows: params.deletedRows,
    allowZeroRows: params.expectedCount === 0
  })

  assertScriptExpectedRowCount({
    operation: params.operation,
    expected: params.expectedCount,
    actual: updatedCount
  })

  return { deletedCount: updatedCount }
}

export function assertQueuedMessagesCleanupAuditPersisted(params: {
  error: { message?: string } | null
  insertedRows: Array<{ id?: string }> | null
}): void {
  assertQueuedMessagesCleanupDeleteSucceeded({
    operation: 'Insert queued-message cleanup audit log',
    error: params.error,
    deletedRows: params.insertedRows,
    expectedCount: 1
  })
}
