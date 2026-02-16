import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

type CleanupFailure = {
  customerId: string
  reason: string
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function isDeleteSpecificCustomersMutationRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION)
}

export function assertDeleteSpecificCustomersMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'delete-specific-customers',
    envVar: 'ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION'
  })
}

export function resolveDeleteSpecificCustomersRows<T>(params: {
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

export function assertDeleteSpecificCustomersTargetsResolved(params: {
  requestedIds: string[]
  fetchedRows: Array<{ id: string }>
}): void {
  const requestedIds = Array.from(new Set(params.requestedIds))
  const fetchedIds = new Set(
    params.fetchedRows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  )

  const missingIds = requestedIds.filter((id) => !fetchedIds.has(id))
  if (missingIds.length === 0) {
    return
  }

  const preview = missingIds.slice(0, 5).join(', ')
  throw new Error(
    `delete-specific-customers target check failed: found ${requestedIds.length - missingIds.length}/${requestedIds.length} requested customer rows; missing IDs: ${preview}`
  )
}

export function assertDeleteSpecificCustomersMutationSucceeded(params: {
  operation: string
  error: { message?: string } | null
  rows: Array<{ id?: string }> | null
  expectedCount: number
}): { updatedCount: number } {
  const { updatedCount } = assertScriptMutationSucceeded({
    operation: params.operation,
    error: params.error,
    updatedRows: params.rows,
    allowZeroRows: params.expectedCount === 0
  })

  assertScriptExpectedRowCount({
    operation: params.operation,
    expected: params.expectedCount,
    actual: updatedCount
  })

  return { updatedCount }
}

export function assertDeleteSpecificCustomersCompletedWithoutFailures(
  failures: CleanupFailure[]
): void {
  if (failures.length === 0) {
    return
  }

  const formatted = failures.map((failure) => `${failure.customerId}:${failure.reason}`)
  assertScriptCompletedWithoutFailures({
    scriptName: 'delete-specific-customers',
    failureCount: failures.length,
    failures: formatted
  })
}
