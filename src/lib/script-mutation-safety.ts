const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return TRUTHY.has(value.trim().toLowerCase())
}

export function assertScriptMutationAllowed(params: {
  scriptName: string
  envVar: string
}): void {
  if (isTruthyEnv(process.env[params.envVar])) {
    return
  }

  throw new Error(
    `${params.scriptName} blocked by safety guard. Set ${params.envVar}=true to run this mutation script.`
  )
}

export function assertScriptMutationSucceeded(params: {
  operation: string
  error: { message?: string } | null
  updatedRows: Array<{ id?: string }> | null
  allowZeroRows?: boolean
}): { updatedCount: number } {
  if (params.error) {
    throw new Error(
      `${params.operation} failed: ${params.error.message || 'unknown database error'}`
    )
  }

  const updatedCount = Array.isArray(params.updatedRows) ? params.updatedRows.length : 0
  if (!params.allowZeroRows && updatedCount === 0) {
    throw new Error(`${params.operation} affected no rows`)
  }

  return { updatedCount }
}

export function assertScriptQuerySucceeded<T>(params: {
  operation: string
  error: { message?: string } | null
  data: T | null
  allowMissing?: boolean
}): T | null {
  if (params.error) {
    throw new Error(
      `${params.operation} failed: ${params.error.message || 'unknown database error'}`
    )
  }

  if (params.data === null && !params.allowMissing) {
    throw new Error(`${params.operation} returned no rows`)
  }

  return params.data
}

export function assertScriptExpectedRowCount(params: {
  operation: string
  expected: number
  actual: number
}): void {
  if (params.expected !== params.actual) {
    throw new Error(
      `${params.operation} affected unexpected row count (expected ${params.expected}, got ${params.actual})`
    )
  }
}

export function assertScriptCompletedWithoutFailures(params: {
  scriptName: string
  failureCount: number
  failures?: string[]
}): void {
  if (params.failureCount <= 0) {
    return
  }

  const preview = Array.isArray(params.failures)
    ? params.failures
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .slice(0, 3)
    : []

  const suffix = preview.length > 0 ? `: ${preview.join(' | ')}` : ''
  throw new Error(
    `${params.scriptName} completed with ${params.failureCount} failure(s)${suffix}`
  )
}
