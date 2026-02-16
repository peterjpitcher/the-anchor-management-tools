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

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }

    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }

  return null
}

function parseOptionalPositiveInt(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function isDeletePeterTestBookingsMutationRunEnabled(
  argv: string[] = process.argv
): boolean {
  if (!argv.includes('--confirm')) {
    return false
  }

  return isTruthyEnv(process.env.RUN_DELETE_PETER_TEST_BOOKINGS_MUTATION)
}

export function assertDeletePeterTestBookingsMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'delete-peter-test-bookings',
    envVar: 'ALLOW_DELETE_PETER_TEST_BOOKINGS_MUTATION'
  })
}

export function readDeletePeterTestBookingsLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalPositiveInt(findFlagValue(argv, '--limit')) ??
    parseOptionalPositiveInt(env.DELETE_PETER_TEST_BOOKINGS_LIMIT)
  )
}

export function assertDeletePeterTestBookingsLimit(limit: number | null, hardCap: number): number {
  if (limit === null) {
    throw new Error('delete-peter-test-bookings blocked: --limit is required in mutation mode.')
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('delete-peter-test-bookings blocked: --limit must be a positive integer.')
  }

  if (limit > hardCap) {
    throw new Error(
      `delete-peter-test-bookings blocked: --limit ${limit} exceeds hard cap ${hardCap}. Run in smaller batches.`
    )
  }

  return limit
}

export function resolveDeletePeterTestBookingsRows<T>(params: {
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

export function assertDeletePeterTestBookingsMutationSucceeded(params: {
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

export function assertDeletePeterTestBookingsCompletedWithoutFailures(params: {
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: 'delete-peter-test-bookings',
    failureCount: params.failureCount,
    failures: params.failures
  })
}
