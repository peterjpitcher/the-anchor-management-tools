import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

export type OldSmsCleanupMessageRow = {
  id: string
  created_at: string
}

export function assertOldSmsCleanupMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'delete-old-sms-messages',
    envVar: 'ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT'
  })
}

export function assertOldSmsCleanupQuerySucceeded<T>(params: {
  operation: string
  error: { message?: string } | null
  data: T | null
  allowMissing?: boolean
}): T | null {
  return assertScriptQuerySucceeded(params)
}

export function selectOldStuckSmsMessages(params: {
  messages: OldSmsCleanupMessageRow[]
  nowMs?: number
  minAgeDays?: number
}): OldSmsCleanupMessageRow[] {
  const nowMs = params.nowMs ?? Date.now()
  const minAgeDays = params.minAgeDays ?? 7
  const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000

  return params.messages.filter((message) => {
    const createdAtMs = Date.parse(message.created_at)
    if (!Number.isFinite(createdAtMs)) {
      return false
    }
    return nowMs - createdAtMs > minAgeMs
  })
}

export function assertOldSmsCleanupDeletionSucceeded(params: {
  operation: string
  error: { message?: string } | null
  deletedRows: Array<{ id?: string }> | null
  expectedCount: number
  allowZeroRows?: boolean
}): { deletedCount: number } {
  const { updatedCount } = assertScriptMutationSucceeded({
    operation: params.operation,
    error: params.error,
    updatedRows: params.deletedRows,
    allowZeroRows: params.allowZeroRows
  })

  assertScriptExpectedRowCount({
    operation: params.operation,
    expected: params.expectedCount,
    actual: updatedCount
  })

  return { deletedCount: updatedCount }
}

export function assertOldSmsCleanupCompletedWithoutFailures(params: {
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: 'delete-old-sms-messages',
    failureCount: params.failureCount,
    failures: params.failures
  })
}
