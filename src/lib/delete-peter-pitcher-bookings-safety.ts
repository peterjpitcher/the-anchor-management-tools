import {
  assertScriptCompletedWithoutFailures,
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

export function isDeletePeterPitcherBookingsMutationRunEnabled(
  argv: string[] = process.argv
): boolean {
  if (!argv.includes('--confirm')) {
    return false
  }

  return isTruthyEnv(process.env.RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION)
}

export function assertDeletePeterPitcherBookingsMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'delete-peter-pitcher-bookings',
    envVar: 'ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION'
  })
}

export function readDeletePeterPitcherBookingsLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalPositiveInt(findFlagValue(argv, '--limit')) ??
    parseOptionalPositiveInt(env.DELETE_PETER_PITCHER_BOOKINGS_LIMIT)
  )
}

export function assertDeletePeterPitcherBookingsLimit(limit: number | null, hardCap: number): number {
  if (limit === null) {
    throw new Error('delete-peter-pitcher-bookings blocked: --limit is required in mutation mode.')
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('delete-peter-pitcher-bookings blocked: --limit must be a positive integer.')
  }

  if (limit > hardCap) {
    throw new Error(
      `delete-peter-pitcher-bookings blocked: --limit ${limit} exceeds hard cap ${hardCap}. Run in smaller batches.`
    )
  }

  return limit
}

export function resolveDeletePeterPitcherBookingsRows<T>(params: {
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

export function assertDeletePeterPitcherBookingsMutationSucceeded(params: {
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

  if (updatedCount !== params.expectedCount) {
    throw new Error(
      `${params.operation} affected unexpected row count (expected ${params.expectedCount}, got ${updatedCount})`
    )
  }

  return { updatedCount }
}

export function assertDeletePeterPitcherBookingsCompletedWithoutFailures(params: {
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: 'delete-peter-pitcher-bookings',
    failureCount: params.failureCount,
    failures: params.failures
  })
}
