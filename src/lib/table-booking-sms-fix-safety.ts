import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

const FIX_TABLE_BOOKING_SMS_PROBE_LIMIT = 1

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

export function resolveFixTableBookingSmsRows<T>(params: {
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

export function assertFixTableBookingSmsProbeMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'fix-table-booking-sms',
    envVar: 'ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION'
  })
}

export function readFixTableBookingSmsProbeLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return findFlagValue(argv, '--limit') ?? env.FIX_TABLE_BOOKING_SMS_PROBE_LIMIT ?? null
}

export function assertFixTableBookingSmsProbeLimit(value: string | null): number {
  if (!value) {
    throw new Error(
      `fix-table-booking-sms blocked: --limit is required in mutation mode (expected --limit=${FIX_TABLE_BOOKING_SMS_PROBE_LIMIT}).`
    )
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed !== FIX_TABLE_BOOKING_SMS_PROBE_LIMIT) {
    throw new Error(
      `fix-table-booking-sms blocked: --limit must be ${FIX_TABLE_BOOKING_SMS_PROBE_LIMIT} in mutation mode.`
    )
  }

  return parsed
}

export function assertFixTableBookingSmsProbeMutationSucceeded(params: {
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

export function assertFixTableBookingSmsCompletedWithoutFailures(params: {
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: 'fix-table-booking-sms',
    failureCount: params.failureCount,
    failures: params.failures
  })
}
