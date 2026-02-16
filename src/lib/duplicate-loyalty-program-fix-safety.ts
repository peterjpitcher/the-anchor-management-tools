import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function isFixDuplicateLoyaltyProgramMutationRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION)
}

export function assertFixDuplicateLoyaltyProgramMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'fix-duplicate-loyalty-program',
    envVar: 'ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION'
  })
}

export function resolveFixDuplicateLoyaltyProgramRows<T>(params: {
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

export function resolveFixDuplicateLoyaltyProgramCount(params: {
  operation: string
  count: number | null
  error: { message?: string } | null
}): number {
  assertScriptQuerySucceeded({
    operation: params.operation,
    error: params.error,
    data: { ok: true }
  })

  return typeof params.count === 'number' && Number.isFinite(params.count)
    ? params.count
    : 0
}

export function assertFixDuplicateLoyaltyProgramMutationSucceeded(params: {
  operation: string
  error: { message?: string } | null
  rows: Array<{ id?: string }> | null
  expectedCount: number
}): void {
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
}

export function assertFixDuplicateLoyaltyProgramCompletedWithoutFailures(params: {
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: 'fix-duplicate-loyalty-program',
    failureCount: params.failureCount,
    failures: params.failures
  })
}
