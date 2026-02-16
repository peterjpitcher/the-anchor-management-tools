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

function parseOptionalNonNegativeInt(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

export type PendingSmsTemplateFixJob = {
  id: string
  payload: unknown
}

export function isFixSmsTemplateKeysMutationEnabled(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    argv.includes('--confirm') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(env.RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION)
  )
}

export function assertFixSmsTemplateKeysMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'fix-sms-template-keys',
    envVar: 'ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT'
  })
}

export function readFixSmsTemplateKeysLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalPositiveInt(findFlagValue(argv, '--limit')) ??
    parseOptionalPositiveInt(env.FIX_SMS_TEMPLATE_KEYS_LIMIT)
  )
}

export function readFixSmsTemplateKeysOffset(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalNonNegativeInt(findFlagValue(argv, '--offset')) ??
    parseOptionalNonNegativeInt(env.FIX_SMS_TEMPLATE_KEYS_OFFSET)
  )
}

export function assertFixSmsTemplateKeysLimit(limit: number | null, hardCap: number): number {
  if (limit === null) {
    throw new Error('fix-sms-template-keys blocked: --limit is required in mutation mode.')
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('fix-sms-template-keys blocked: --limit must be a positive integer.')
  }

  if (limit > hardCap) {
    throw new Error(
      `fix-sms-template-keys blocked: --limit ${limit} exceeds hard cap ${hardCap}. Run in smaller batches.`
    )
  }

  return limit
}

export function resolvePendingSmsTemplateFixJobs(params: {
  jobs: PendingSmsTemplateFixJob[] | null
  error: { message?: string } | null
}): PendingSmsTemplateFixJob[] {
  assertScriptQuerySucceeded({
    operation: 'Load pending SMS jobs for template fix',
    error: params.error,
    data: { ok: true }
  })

  return Array.isArray(params.jobs) ? params.jobs : []
}

export function shouldFixLegacyTemplate(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const template = (payload as { template?: unknown }).template
  return template === 'table_booking_confirmation'
}

export function assertFixSmsTemplateUpdateSucceeded(params: {
  error: { message?: string } | null
  updatedRows: Array<{ id?: string }> | null
  expectedCount: number
}): { updatedCount: number } {
  const { updatedCount } = assertScriptMutationSucceeded({
    operation: 'Update pending SMS template key',
    error: params.error,
    updatedRows: params.updatedRows,
    allowZeroRows: params.expectedCount === 0
  })

  assertScriptExpectedRowCount({
    operation: 'Update pending SMS template key',
    expected: params.expectedCount,
    actual: updatedCount
  })

  return { updatedCount }
}

export function assertFixSmsTemplateKeysCompletedWithoutFailures(params: {
  failureCount: number
  failures?: string[]
}): void {
  assertScriptCompletedWithoutFailures({
    scriptName: 'fix-sms-template-keys',
    failureCount: params.failureCount,
    failures: params.failures
  })
}
