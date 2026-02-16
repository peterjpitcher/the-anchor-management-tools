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

export function isDeleteInvoiceCleanupMutationRunEnabled(params: {
  argv?: string[]
  runEnvVar: string
}): boolean {
  const argv = params.argv ?? process.argv
  if (!argv.includes('--confirm')) {
    return false
  }

  return isTruthyEnv(process.env[params.runEnvVar])
}

export function assertDeleteInvoiceCleanupMutationAllowed(params: {
  scriptName: string
  allowEnvVar: string
}): void {
  assertScriptMutationAllowed({
    scriptName: params.scriptName,
    envVar: params.allowEnvVar
  })
}

export function readDeleteInvoiceCleanupLimit(params: {
  argv?: string[]
  limitEnvVar: string
}): number | null {
  const argv = params.argv ?? process.argv
  return (
    parseOptionalPositiveInt(findFlagValue(argv, '--limit')) ??
    parseOptionalPositiveInt(process.env[params.limitEnvVar])
  )
}

export function assertDeleteInvoiceCleanupLimit(params: {
  scriptName: string
  limit: number | null
  hardCap: number
}): number {
  if (params.limit === null) {
    throw new Error(`${params.scriptName} blocked: --limit is required in mutation mode.`)
  }

  if (!Number.isFinite(params.limit) || params.limit <= 0) {
    throw new Error(`${params.scriptName} blocked: --limit must be a positive integer.`)
  }

  if (params.limit > params.hardCap) {
    throw new Error(
      `${params.scriptName} blocked: --limit ${params.limit} exceeds hard cap ${params.hardCap}. Run in smaller batches.`
    )
  }

  return params.limit
}

export function resolveDeleteInvoiceCleanupRows<T>(params: {
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

export function assertDeleteInvoiceCleanupMutationSucceeded(params: {
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

export function assertDeleteInvoiceCleanupCompletedWithoutFailures(params: {
  scriptName: string
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: params.scriptName,
    failureCount: params.failureCount,
    failures: params.failures
  })
}
