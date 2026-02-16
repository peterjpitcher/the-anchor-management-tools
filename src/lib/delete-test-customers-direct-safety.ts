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

export function isDeleteTestCustomersDirectMutationRunEnabled(
  argv: string[] = process.argv
): boolean {
  if (!argv.includes('--confirm')) {
    return false
  }

  return isTruthyEnv(process.env.RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION)
}

function parseOptionalPositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function readDeleteTestCustomersDirectLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.DELETE_TEST_CUSTOMERS_DIRECT_LIMIT)
}

export function assertDeleteTestCustomersDirectLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('delete-test-customers-direct blocked: limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `delete-test-customers-direct blocked: limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function assertDeleteTestCustomersDirectMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'delete-test-customers-direct',
    envVar: 'ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION'
  })
}

export function resolveDeleteTestCustomersDirectRows<T>(params: {
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

export function assertDeleteTestCustomersDirectMutationSucceeded(params: {
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

export function assertDeleteTestCustomersDirectTargetMatches(params: {
  customerId: string
  firstName: string | null
  lastName: string | null
}): void {
  const firstName = params.firstName?.toLowerCase() ?? ''
  const lastName = params.lastName?.toLowerCase() ?? ''

  if (firstName.includes('test') || lastName.includes('test')) {
    return
  }

  throw new Error(
    `Refusing to delete customer ${params.customerId} because target no longer matches expected "test" filter.`
  )
}

export function assertDeleteTestCustomersDirectCompletedWithoutFailures(params: {
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: 'delete-test-customers-direct',
    failureCount: params.failureCount,
    failures: params.failures
  })
}
